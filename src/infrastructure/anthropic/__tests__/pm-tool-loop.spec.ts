import { AnthropicProjectManagerService } from '@infrastructure/anthropic/anthropic-project-manager.service';

const env = { get: () => undefined } as any;
const message = (content: unknown[], stop_reason: string) => ({
  content,
  stop_reason,
  usage: {},
});

const fakeClient = (responses: unknown[]) => {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      stream: jest.fn((params: unknown) => {
        calls.push(JSON.parse(JSON.stringify(params)));
        const next = responses.shift();
        return { finalMessage: () => Promise.resolve(next) };
      }),
    },
  };
};

const request = (run: jest.Mock) => ({
  brief: 'b',
  knowledge: 'k',
  snapshot: 's',
  history: [],
  question: 'where is login?',
  tools: {
    specs: [
      {
        name: 'search_code',
        description: 'd',
        input_schema: { type: 'object' as const, properties: {} },
      },
    ],
    run,
  },
  deadline: Date.now() + 240_000,
});

describe('AnthropicProjectManagerService tool loop', () => {
  it('runs requested tools, feeds results back and returns the final text', async () => {
    const client = fakeClient([
      message(
        [
          {
            type: 'tool_use',
            id: 't1',
            name: 'search_code',
            input: { repo: 'api', query: 'login' },
          },
        ],
        'tool_use',
      ),
      message(
        [{ type: 'text', text: 'Login lives in auth.controller.ts:12' }],
        'end_turn',
      ),
    ]);
    const run = jest.fn().mockResolvedValue('<tool_data>hit</tool_data>');
    const service = new AnthropicProjectManagerService(env, client as any);

    await expect(service.answer(request(run))).resolves.toBe(
      'Login lives in auth.controller.ts:12',
    );
    expect(run).toHaveBeenCalledWith('search_code', {
      repo: 'api',
      query: 'login',
    });
    const second = client.calls[1];
    expect(second.tool_choice).toEqual({ type: 'auto' });
    expect(second.messages.at(-1).content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't1',
      content: '<tool_data>hit</tool_data>',
    });
  });

  it('reports a failing tool as is_error instead of crashing', async () => {
    const client = fakeClient([
      message(
        [{ type: 'tool_use', id: 't1', name: 'search_code', input: {} }],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Could not search.' }], 'end_turn'),
    ]);
    const run = jest.fn().mockRejectedValue(new Error('rate limited'));
    await new AnthropicProjectManagerService(env, client as any).answer(
      request(run),
    );
    expect(client.calls[1].messages.at(-1).content[0]).toMatchObject({
      is_error: true,
      content: 'rate limited',
    });
  });

  it('forces a final answer without tools after the iteration cap', async () => {
    const loop = Array.from({ length: 8 }, (_, i) =>
      message(
        [{ type: 'tool_use', id: `t${i}`, name: 'search_code', input: {} }],
        'tool_use',
      ),
    );
    const client = fakeClient([
      ...loop,
      message([{ type: 'text', text: 'Best effort answer' }], 'end_turn'),
    ]);
    const run = jest.fn().mockResolvedValue('x');
    await expect(
      new AnthropicProjectManagerService(env, client as any).answer(
        request(run),
      ),
    ).resolves.toBe('Best effort answer');
    const last = client.calls[client.calls.length - 1];
    expect(last.tool_choice).toEqual({ type: 'none' });
    expect(JSON.stringify(last.messages.at(-1))).toContain('Answer now');
    expect(client.calls).toHaveLength(9);
  });

  it('keeps thinking on, sends effort, and caches knowledge and snapshot separately', async () => {
    const client = fakeClient([
      message([{ type: 'text', text: 'ok' }], 'end_turn'),
    ]);
    await new AnthropicProjectManagerService(env, client as any).answer(
      request(jest.fn()),
    );
    const params = client.calls[0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.output_config.effort).toBe('high');
    expect(params.system.map((b: any) => Boolean(b.cache_control))).toEqual([
      false,
      true,
      true,
    ]);
  });
});
