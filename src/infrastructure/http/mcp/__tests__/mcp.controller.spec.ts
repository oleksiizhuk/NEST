import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpController } from '@infrastructure/http/mcp/mcp.controller';
import { McpTokenGuard } from '@infrastructure/http/mcp/guards/mcp-token.guard';
import { McpDailyLimitGuard } from '@infrastructure/http/mcp/guards/mcp-daily-limit.guard';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import { ReportOutcomeUseCase } from '@application/mcp/use-cases/report-outcome.use-case';
import { ListOpenTasksUseCase } from '@application/mcp/use-cases/list-open-tasks.use-case';
import { CODE_ASSISTANT_SERVICE } from '@application/mcp/code-assistant.service.interface';
import { MCP_TASK_REPOSITORY } from '@domain/mcp-task/mcp-task.repository.interface';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';

const TOKEN = 'test-mcp-token';

// End-to-end over a real socket: the same MCP client library an IDE uses
// talks to the controller, so the transport wiring is what gets tested
describe('McpController (streamable HTTP)', () => {
  let app: INestApplication;
  let url: string;
  const assistant = { ask: jest.fn(), plan: jest.fn() };
  const tasks = new InMemoryTaskRepository();
  const text = (result: unknown) =>
    ((result as { content: { text: string }[] }).content ?? [])
      .map((c) => c.text)
      .join('\n');

  const connect = async (token = TOKEN) => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await client.connect(transport);
    return client;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController],
      providers: [
        McpTokenGuard,
        // Daily-limit guard with no Mongo model injected (optional): with
        // MCP_DAILY_LIMIT unset the cap is off, so it is a pass-through here.
        McpDailyLimitGuard,
        AskClaudeUseCase,
        StartTaskUseCase,
        ReportOutcomeUseCase,
        ListOpenTasksUseCase,
        { provide: CODE_ASSISTANT_SERVICE, useValue: assistant },
        { provide: MCP_TASK_REPOSITORY, useValue: tasks },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'MCP_TOKEN' ? TOKEN : ''),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    tasks.rows.clear();
  });

  it('lists the task tools and sends the protocol as instructions', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const instructions = client.getInstructions();
    await client.close();

    expect(tools.map((t) => t.name)).toEqual([
      'start_task',
      'ask_advice',
      'report_outcome',
      'list_open_tasks',
    ]);
    expect(tools[1].inputSchema).toMatchObject({
      type: 'object',
      required: ['prompt'],
      properties: { model: { enum: ['opus', 'sonnet', 'fable'] } },
    });
    expect(tools[2].inputSchema).toMatchObject({
      required: ['task_id', 'status', 'details'],
      properties: { status: { enum: ['solved', 'not_solved', 'partial'] } },
    });
    expect(instructions).toContain('Always finish with report_outcome');
  });

  it('runs a task from start to a report', async () => {
    assistant.plan.mockResolvedValue(['the failing test output']);
    assistant.ask.mockResolvedValue({
      text: 'Guard x.',
      needInfo: false,
      hypothesis: 'x is null',
    });
    const client = await connect();

    const started = text(
      await client.callTool({
        name: 'start_task',
        arguments: { goal: 'fix the crash' },
      }),
    );
    const taskId = /Task (t-[0-9a-f]{10}) started/.exec(started)[1];
    const answer = text(
      await client.callTool({
        name: 'ask_advice',
        arguments: { task_id: taskId, prompt: 'how?', context: 'log' },
      }),
    );
    const open = text(
      await client.callTool({ name: 'list_open_tasks', arguments: {} }),
    );
    const reported = text(
      await client.callTool({
        name: 'report_outcome',
        arguments: { task_id: taskId, status: 'solved', details: 'tests pass' },
      }),
    );
    await client.close();

    expect(started).toContain('1. the failing test output');
    expect(answer).toContain('Guard x.');
    expect(answer).toContain(`report_outcome { task_id: "${taskId}"`);
    expect(open).toContain(`${taskId}: fix the crash [WAITING FOR YOUR REPORT`);
    expect(reported).toContain('closed as solved');
    expect(tasks.rows.get(taskId).status).toBe('solved');
  });

  it('rejects a malformed task_id before touching the model', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'ask_advice',
      arguments: { task_id: '../x', prompt: 'hi' },
    });
    await client.close();

    expect(result.isError).toBe(true);
    expect(assistant.ask).not.toHaveBeenCalled();
  });

  it('routes ask_advice without a task to the use case and returns the answer', async () => {
    assistant.ask.mockResolvedValue({ text: 'Use ?. here.', needInfo: false });
    const client = await connect();

    const result = await client.callTool({
      name: 'ask_advice',
      arguments: {
        prompt: 'why does this throw?',
        context: 'x.y',
        model: 'fable',
      },
    });
    await client.close();

    expect(assistant.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'why does this throw?',
        context: 'x.y',
        model: 'fable',
        task: expect.objectContaining({ goal: 'why does this throw?' }),
      }),
    );
    expect(text(result)).toMatch(/^Use \?\. here\.\n\n---\ntask_id: t-/);
    expect(result.isError).toBeFalsy();
  });

  it('turns an assistant failure into an isError tool result, not a transport error', async () => {
    assistant.ask.mockRejectedValue(new Error('rate limited'));
    const client = await connect();

    const result = await client.callTool({
      name: 'ask_advice',
      arguments: { prompt: 'hi', model: 'sonnet' },
    });
    await client.close();

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'ask_advice could not complete the request. Check the server logs for the cause.',
      },
    ]);
  });

  it('rejects a wrong token with 401 before touching MCP', async () => {
    await expect(connect('wrong')).rejects.toThrow(/401/);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(assistant.ask).not.toHaveBeenCalled();
  });

  it('answers GET and DELETE with 405 (stateless server)', async () => {
    const headers = { Authorization: `Bearer ${TOKEN}` };
    const get = await fetch(url, { headers });
    const del = await fetch(url, { method: 'DELETE', headers });

    expect(get.status).toBe(405);
    expect(del.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
  });
});
