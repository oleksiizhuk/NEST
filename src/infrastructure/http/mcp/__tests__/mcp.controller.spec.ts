import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpController } from '@infrastructure/http/mcp/mcp.controller';
import {
  McpStatsTokenGuard,
  McpTokenGuard,
} from '@infrastructure/http/mcp/guards/mcp-token.guard';
import { McpDailyLimitGuard } from '@infrastructure/http/mcp/guards/mcp-daily-limit.guard';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import { ReportOutcomeUseCase } from '@application/mcp/use-cases/report-outcome.use-case';
import { ListOpenTasksUseCase } from '@application/mcp/use-cases/list-open-tasks.use-case';
import { CODE_ASSISTANT_SERVICE } from '@application/mcp/code-assistant.service.interface';
import { MCP_TASK_REPOSITORY } from '@domain/mcp-task/mcp-task.repository.interface';
import { MCP_USAGE_REPOSITORY } from '@domain/mcp-task/mcp-usage.repository.interface';
import { GetMcpStatsUseCase } from '@application/mcp/use-cases/get-mcp-stats.use-case';
import { MCP_DAILY_BUDGET } from '@application/mcp/mcp-budget';
import { McpStatsController } from '@infrastructure/http/mcp/mcp-stats.controller';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';

const TOKEN = 'test-mcp-token';
const STATS_TOKEN = 'owner-stats-token-0123456789abcdef';

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

  const CODE = 'const x = null; x.y;\n'.repeat(20);
  const connect = async (token = TOKEN, extra: Record<string, string> = {}) => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}`, ...extra } },
    });
    await client.connect(transport);
    return client;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [McpController, McpStatsController],
      providers: [
        McpTokenGuard,
        // Daily-limit guard on the stub counter below, which never passes
        // the 200-unit budget
        McpDailyLimitGuard,
        AskClaudeUseCase,
        StartTaskUseCase,
        ReportOutcomeUseCase,
        ListOpenTasksUseCase,
        { provide: CODE_ASSISTANT_SERVICE, useValue: assistant },
        { provide: MCP_TASK_REPOSITORY, useValue: tasks },
        {
          provide: MCP_USAGE_REPOSITORY,
          useValue: {
            increment: async () => 1,
            giveBack: async () => undefined,
            usageOn: async () => ({ units: 7, free: 2, refused: 0 }),
          },
        },
        GetMcpStatsUseCase,
        { provide: MCP_DAILY_BUDGET, useValue: 200 },
        McpStatsTokenGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ MCP_TOKEN: TOKEN, MCP_STATS_TOKEN: STATS_TOKEN }[key] ?? ''),
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
      properties: {
        status: { enum: ['solved', 'not_solved', 'partial', 'abandoned'] },
      },
    });
    expect(instructions).toContain('Always call report_outcome');
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
    expect(open).toContain(
      `${taskId}: "fix the crash" [WAITING FOR YOUR REPORT`,
    );
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
        context: CODE,
        model: 'fable',
        task_id: '',
      },
    });
    await client.close();

    expect(assistant.ask).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'why does this throw?',
        context: CODE.trim(),
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
      arguments: { prompt: 'hi', model: 'sonnet', context: CODE },
    });
    assistant.plan.mockRejectedValue(new Error('db down'));
    const other = await client.callTool({
      name: 'list_open_tasks',
      arguments: {},
    });
    await client.close();

    // The caller learns the task_id and what to do; no upstream detail
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(
      /^The advice call failed .*task_id "t-[0-9a-f]{10}"/,
    );
    expect(text(result)).not.toContain('rate limited');
    expect(other.isError).toBeFalsy();
  });

  it('answers a bare question with the checklist and scopes lists to the client', async () => {
    assistant.plan.mockResolvedValue(['the code']);
    const kiro = await connect(TOKEN, { 'X-MCP-Client': 'kiro' });
    const bare = text(
      await kiro.callTool({
        name: 'ask_advice',
        arguments: { prompt: 'why?' },
      }),
    );
    const mine = text(
      await kiro.callTool({ name: 'list_open_tasks', arguments: {} }),
    );
    await kiro.close();
    const cursor = await connect(TOKEN, { 'X-MCP-Client': 'cursor' });
    const theirs = text(
      await cursor.callTool({ name: 'list_open_tasks', arguments: {} }),
    );
    await cursor.close();

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(bare).toContain('Your question is not answered yet');
    expect(mine).toContain('"why?"');
    expect(theirs).toBe('No open tasks.');
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

  it('GET /mcp/stats takes only the owner stats token, never the IDE token', async () => {
    await tasks.create('t-0000000001', 'kiro', 'fix login', []);
    const as = (token: string) => ({
      headers: { Authorization: `Bearer ${token}` },
    });

    const none = await fetch(`${url}/stats`);
    const ide = await fetch(`${url}/stats`, as(TOKEN));
    const res = await fetch(`${url}/stats?days=3`, as(STATS_TOKEN));
    const body = await res.json();
    const blank = await fetch(`${url}/stats?days=%20`, as(STATS_TOKEN));

    expect(none.status).toBe(401);
    expect(ide.status).toBe(401);
    expect(res.status).toBe(200);
    expect(body.period.days).toBe(3);
    expect((await blank.json()).period.days).toBe(7);
    expect(body.started.total).toBe(1);
    expect(body.byClient[0].client).toBe('kiro');
    // Just opened: counted as open, not yet stuck
    expect(body.open.total).toBe(1);
    expect(body.open.stuck).toEqual([]);
    expect(body.budget).toMatchObject({
      limit: 200,
      used: 7,
      refused: 0,
      left: 193,
      freeCalls: 2,
    });
    expect(assistant.ask).not.toHaveBeenCalled();
    expect(assistant.plan).not.toHaveBeenCalled();
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
