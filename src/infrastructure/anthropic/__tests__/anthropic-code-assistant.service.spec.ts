import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

const mockFinalMessage = jest.fn();
const mockStream: jest.Mock = jest.fn(() => ({
  finalMessage: mockFinalMessage,
}));

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { stream: mockStream },
  })),
}));

// Imported after the mock so the service picks up the stubbed SDK
import { AnthropicCodeAssistantService } from '@infrastructure/anthropic/anthropic-code-assistant.service';

const textMessage = (
  text: string,
  stop_reason = 'end_turn',
  extra: Record<string, unknown> = {},
) => ({
  stop_reason,
  content: [{ type: 'text', text }],
  ...extra,
});

const configWith = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] } as unknown as ConfigService);

describe('AnthropicCodeAssistantService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  it('sends the prompt and context as separate blocks with the default model', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('use optional chaining'));
    const service = new AnthropicCodeAssistantService(
      configWith({ ANTHROPIC_KEY: 'k' }),
    );

    const answer = await service.ask({
      prompt: 'why does this throw?',
      context: 'x.y',
    });

    expect(answer.text).toBe('use optional chaining');
    const request = mockStream.mock.calls[0][0] as any;
    expect(request.model).toBe('claude-opus-5-5');
    expect(request.output_config).toEqual({ effort: 'high' });
    expect(request.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '<context>\nx.y\n</context>' },
          { type: 'text', text: 'why does this throw?' },
        ],
      },
    ]);
  });

  it('resolves MCP_AI_MODEL as a short name or a raw id and honours MCP_AI_EFFORT', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'));

    await new AnthropicCodeAssistantService(
      configWith({ MCP_AI_MODEL: 'sonnet', MCP_AI_EFFORT: 'low' }),
    ).ask({ prompt: 'a' });
    await new AnthropicCodeAssistantService(
      configWith({
        MCP_AI_MODEL: 'claude-haiku-4-5-20251001',
        MCP_AI_EFFORT: 'turbo',
      }),
    ).ask({ prompt: 'b' });

    const [first, second] = mockStream.mock.calls.map((c) => c[0] as any);
    expect(first.model).toBe('claude-sonnet-5');
    expect(first.output_config).toEqual({ effort: 'low' });
    expect(second.model).toBe('claude-haiku-4-5-20251001');
    expect(second.output_config).toEqual({ effort: 'high' });
  });

  it('lets a call pick its own model and falls back to the default otherwise', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'));
    const service = new AnthropicCodeAssistantService(
      configWith({ MCP_AI_MODEL: 'sonnet' }),
    );

    await service.ask({ prompt: 'a', model: 'fable' });
    await service.ask({ prompt: 'b', model: 'opus' });
    await service.ask({ prompt: 'c' });

    expect(mockStream.mock.calls.map((c) => (c[0] as any).model)).toEqual([
      'claude-fable-5-1',
      'claude-opus-5-5',
      'claude-sonnet-5',
    ]);
  });

  it('sends only the prompt when there is no context', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'));

    await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'hello',
    });

    const request = mockStream.mock.calls[0][0] as any;
    expect(request.messages[0].content).toEqual([
      { type: 'text', text: 'hello' },
    ]);
  });

  it('joins several text blocks', async () => {
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'first' },
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'second' },
      ],
    });

    const answer = await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'x',
    });

    expect(answer.text).toBe('first\n\nsecond');
  });

  it('flags a truncated answer', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('partial', 'max_tokens'));

    const answer = await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'x',
    });

    expect(answer.text).toMatch(/^partial\n\n\[answer truncated at 16384/);
  });

  it('explains when the whole budget went to thinking and no text came back', async () => {
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'thinking', thinking: '' }],
    });

    const answer = await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'x',
    });

    expect(answer.text).toMatch(/spent the whole 16384-token budget thinking/);
  });

  it('asks for adaptive thinking with a 16k budget, no retries and a timeout under the Vercel cap', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'));

    await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'x',
    });

    const request = mockStream.mock.calls[0][0] as any;
    expect(request.max_tokens).toBe(16384);
    expect(request.thinking).toEqual({ type: 'adaptive' });
    const Sdk = jest.requireMock('@anthropic-ai/sdk').default as jest.Mock;
    expect(Sdk.mock.calls[0][0]).toMatchObject({
      timeout: 250000,
      maxRetries: 0,
    });
  });

  it('reports a refusal instead of returning an empty string', async () => {
    mockFinalMessage.mockResolvedValue(
      textMessage('', 'refusal', {
        stop_details: { type: 'refusal', explanation: 'policy' },
      }),
    );

    const answer = await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'x',
    });

    expect(answer.text).toBe('Claude declined to answer this request: policy');
  });

  describe('task protocol', () => {
    it('sends the task before the context and the question', async () => {
      mockFinalMessage.mockResolvedValue(textMessage('ok'));

      await new AnthropicCodeAssistantService(configWith({})).ask({
        prompt: 'q',
        context: 'code',
        task: {
          goal: 'fix login',
          checklist: ['the error'],
          history: [
            { kind: 'answer', note: 'token expired' },
            { kind: 'report', note: 'still 401', outcome: 'not_solved' },
          ],
          round: 2,
          maxRounds: 5,
          unreported: false,
        },
      });

      const request = mockStream.mock.calls[0][0] as any;
      expect(request.messages[0].content).toEqual([
        {
          type: 'text',
          text:
            '<task>\ngoal: fix login\nround: 2 of 5\nchecklist:\n- the error\n' +
            'earlier rounds:\n- [answer] token expired\n' +
            '- [report: not_solved] still 401\n</task>',
        },
        { type: 'text', text: '<context>\ncode\n</context>' },
        { type: 'text', text: 'q' },
      ]);
      expect(request.system).toContain('NEED_INFO');
      expect(request.system).toContain('HYPOTHESIS:');
    });

    it('reads NEED_INFO and HYPOTHESIS lines in the formats models use', () => {
      const parse = AnthropicCodeAssistantService.parseReply;
      expect(parse('\nNEED_INFO\n1. Send src/a.ts\n2. Run npm test')).toEqual({
        text: '1. Send src/a.ts\n2. Run npm test',
        needInfo: true,
      });
      for (const first of [
        '**NEED_INFO:** send src/a.ts',
        '## NEED_INFO: send src/a.ts',
        '`NEED_INFO` send src/a.ts',
        'NEED_INFO — send src/a.ts',
      ]) {
        expect(parse(first)).toEqual({ text: 'send src/a.ts', needInfo: true });
      }

      expect(
        parse(
          'Fix it.\n\nHow to verify: run it\n\n**HYPOTHESIS:** stale token; refresh first\n```\n',
        ),
      ).toEqual({
        text: 'Fix it.\n\nHow to verify: run it\n\n```',
        needInfo: false,
        hypothesis: 'stale token; refresh first',
      });
      expect(parse('Fix.\n- _HYPOTHESIS:_ x\nGood luck!')).toEqual({
        text: 'Fix.\nGood luck!',
        needInfo: false,
        hypothesis: 'x',
      });
      // What is kept comes from the raw line: `__init__.py` survives
      expect(
        parse('Fix.\nHYPOTHESIS: `__init__.py` imports twice').hypothesis,
      ).toBe('`__init__.py` imports twice');
      // A fence with a language tag is a fence too
      expect(parse('```markdown\nNEED_INFO\n1. send x\n```')).toEqual({
        text: '1. send x',
        needInfo: true,
      });
      // A reply wrapped in a fence loses the fence pair, not the list
      expect(parse('```\nNEED_INFO\n1. send a.ts\n```')).toEqual({
        text: '1. send a.ts',
        needInfo: true,
      });

      // NEED_INFO only as the first line; no colon, no hypothesis
      expect(parse('See NEED_INFO docs\nHypothesis testing matters')).toEqual({
        text: 'See NEED_INFO docs\nHypothesis testing matters',
        needInfo: false,
      });
    });

    it('marks a refusal or an empty budget as no answer', async () => {
      mockFinalMessage.mockResolvedValueOnce(textMessage('', 'refusal'));
      mockFinalMessage.mockResolvedValueOnce(textMessage('', 'max_tokens'));
      const service = new AnthropicCodeAssistantService(configWith({}));

      expect((await service.ask({ prompt: 'x' })).noAnswer).toBe(true);
      expect((await service.ask({ prompt: 'x' })).noAnswer).toBe(true);
    });

    it('tells the model about the last round and an unreported answer', async () => {
      mockFinalMessage.mockResolvedValue(textMessage('ok'));

      await new AnthropicCodeAssistantService(configWith({})).ask({
        prompt: 'q',
        task: {
          goal: 'g',
          checklist: [],
          history: [],
          round: 5,
          maxRounds: 5,
          unreported: true,
        },
      });

      const block = (mockStream.mock.calls[0][0] as any).messages[0].content[0]
        .text;
      expect(block).toContain('this is the last round');
      expect(block).toContain('never reported on');
    });

    it('plans a checklist with the fast model and falls back on failure', async () => {
      mockFinalMessage.mockResolvedValueOnce(
        textMessage('Here:\n- src/login.ts\n2. the 401 body\n* versions'),
      );
      const service = new AnthropicCodeAssistantService(configWith({}));

      const items = await service.plan({ goal: 'fix login', context: 'c' });

      expect(items).toEqual(['src/login.ts', 'the 401 body', 'versions']);
      const request = mockStream.mock.calls[0][0] as any;
      expect(request.model).toBe('claude-sonnet-5');
      expect(request.output_config).toEqual({ effort: 'low' });
      expect(request.messages[0].content).toEqual([
        { type: 'text', text: '<goal>\nfix login\n</goal>' },
        { type: 'text', text: '<context>\nc\n</context>' },
      ]);

      mockFinalMessage.mockRejectedValueOnce(
        Object.assign(new Error('bad'), { status: 400 }),
      );
      const fallback = await service.plan({ goal: 'fix login' });
      expect(fallback.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('retry', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const run = async (service: AnthropicCodeAssistantService) => {
      // Settled up front so a rejection is never unhandled while the fake
      // clock runs
      const pending = service.ask({ prompt: 'x' }).then(
        (value) => ({ value }),
        (error: Error) => ({ error }),
      );
      await jest.advanceTimersByTimeAsync(2000);
      const result = await pending;
      if ('error' in result) throw result.error;
      return result.value;
    };

    it('retries once when the API is overloaded, with only the time left', async () => {
      mockFinalMessage
        .mockRejectedValueOnce(
          Object.assign(new Error('busy'), { status: 529 }),
        )
        .mockResolvedValueOnce(textMessage('ok'));

      const answer = await run(
        new AnthropicCodeAssistantService(configWith({})),
      );

      expect(answer.text).toBe('ok');
      expect(mockStream).toHaveBeenCalledTimes(2);
      const [first, second] = mockStream.mock.calls.map(
        (c) => (c as unknown[])[1] as { timeout: number },
      );
      expect(first.timeout).toBeLessThanOrEqual(250000);
      expect(second.timeout).toBeLessThan(first.timeout);
    });

    it('gives up after the second failure', async () => {
      mockFinalMessage.mockRejectedValue(
        Object.assign(new Error('busy'), { status: 429 }),
      );

      await expect(
        run(new AnthropicCodeAssistantService(configWith({}))),
      ).rejects.toThrow('busy');
      expect(mockStream).toHaveBeenCalledTimes(2);
    });

    it('retries an overload that arrives mid-stream as an error event', async () => {
      mockFinalMessage
        .mockRejectedValueOnce(
          Object.assign(new Error('busy'), { type: 'overloaded_error' }),
        )
        .mockResolvedValueOnce(textMessage('ok'));

      const answer = await run(
        new AnthropicCodeAssistantService(configWith({})),
      );

      expect(answer.text).toBe('ok');
      expect(mockStream).toHaveBeenCalledTimes(2);
    });

    it('does not retry when the failure came after the retry window', async () => {
      mockFinalMessage.mockImplementationOnce(async () => {
        jest.setSystemTime(Date.now() + 31_000);
        throw Object.assign(new Error('late'), { status: 529 });
      });

      await expect(
        run(new AnthropicCodeAssistantService(configWith({}))),
      ).rejects.toThrow('late');
      expect(mockStream).toHaveBeenCalledTimes(1);
    });

    it('does not retry a client error', async () => {
      mockFinalMessage.mockRejectedValue(
        Object.assign(new Error('bad'), { status: 400 }),
      );

      await expect(
        run(new AnthropicCodeAssistantService(configWith({}))),
      ).rejects.toThrow('bad');
      expect(mockStream).toHaveBeenCalledTimes(1);
    });
  });
});
