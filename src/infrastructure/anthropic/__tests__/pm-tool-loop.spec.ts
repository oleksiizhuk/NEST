import {
  AnthropicProjectManagerService,
  markCacheTail,
} from '@infrastructure/anthropic/anthropic-project-manager.service';

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

  it('reports tokens, iterations, tools and time once per answer', async () => {
    const client = fakeClient([
      {
        ...message(
          [{ type: 'tool_use', id: 't1', name: 'search_code', input: {} }],
          'tool_use',
        ),
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 50,
          output_tokens: 20,
        },
      },
      {
        ...message([{ type: 'text', text: 'done' }], 'end_turn'),
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 5100,
          output_tokens: 300,
        },
      },
    ]);
    const onUsage = jest.fn();
    const service = new AnthropicProjectManagerService(env, client as any);
    await service.answer({
      ...request(jest.fn().mockResolvedValue('x')),
      onUsage,
    });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage.mock.calls[0][0]).toMatchObject({
      model: 'claude-opus-5-5',
      iterations: 2,
      tools: ['search_code'],
      inputTokens: 110,
      cacheReadTokens: 10_100,
      cacheWriteTokens: 50,
      outputTokens: 320,
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

describe('AnthropicProjectManagerService in Nest DI', () => {
  it('resolves with only ConfigService available, as in production', async () => {
    const { Test } = await import('@nestjs/testing');
    const { ConfigService } = await import('@nestjs/config');
    const moduleRef = await Test.createTestingModule({
      providers: [
        AnthropicProjectManagerService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    expect(moduleRef.get(AnthropicProjectManagerService)).toBeInstanceOf(
      AnthropicProjectManagerService,
    );
  });
});

describe('markCacheTail', () => {
  it('keeps exactly one breakpoint, on the newest block', () => {
    const messages: any[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a' }] },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            content: 'x',
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'b' }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'b', content: 'y' },
          { type: 'text', text: 'wrap up' },
        ],
      },
    ];
    markCacheTail(messages);
    const marked = messages.flatMap((m) =>
      Array.isArray(m.content)
        ? m.content.filter((b: any) => b.cache_control)
        : [],
    );
    expect(marked).toEqual([
      { type: 'text', text: 'wrap up', cache_control: { type: 'ephemeral' } },
    ]);
  });
});
