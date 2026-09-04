import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AddressInfo } from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpController } from '@infrastructure/http/mcp/mcp.controller';
import { McpTokenGuard } from '@infrastructure/http/mcp/guards/mcp-token.guard';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { CODE_ASSISTANT_SERVICE } from '@application/mcp/code-assistant.service.interface';

const TOKEN = 'test-mcp-token';

// End-to-end over a real socket: the same MCP client library an IDE uses
// talks to the controller, so the transport wiring is what gets tested
describe('McpController (streamable HTTP)', () => {
  let app: INestApplication;
  let url: string;
  const assistant = { ask: jest.fn() };

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
        AskClaudeUseCase,
        { provide: CODE_ASSISTANT_SERVICE, useValue: assistant },
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
  beforeEach(() => jest.clearAllMocks());

  it('lists the ask_claude tool', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((t) => t.name)).toEqual(['ask_claude']);
    expect(tools[0].inputSchema).toMatchObject({
      type: 'object',
      required: ['prompt'],
    });
  });

  it('routes ask_claude to the use case and returns the answer', async () => {
    assistant.ask.mockResolvedValue('Use ?. here.');
    const client = await connect();

    const result = await client.callTool({
      name: 'ask_claude',
      arguments: { prompt: 'why does this throw?', context: 'x.y' },
    });
    await client.close();

    expect(assistant.ask).toHaveBeenCalledWith({
      prompt: 'why does this throw?',
      context: 'x.y',
    });
    expect(result.content).toEqual([{ type: 'text', text: 'Use ?. here.' }]);
    expect(result.isError).toBeFalsy();
  });

  it('turns an assistant failure into an isError tool result, not a transport error', async () => {
    assistant.ask.mockRejectedValue(new Error('rate limited'));
    const client = await connect();

    const result = await client.callTool({
      name: 'ask_claude',
      arguments: { prompt: 'hi' },
    });
    await client.close();

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'ask_claude failed: rate limited' },
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
