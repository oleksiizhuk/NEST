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

    expect(answer).toBe('use optional chaining');
    const request = mockStream.mock.calls[0][0] as any;
    expect(request.model).toBe('claude-opus-5');
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
      'claude-opus-5',
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

    expect(answer).toBe('first\n\nsecond');
  });

  it('flags a truncated answer', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('partial', 'max_tokens'));

    const answer = await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'x',
    });

    expect(answer).toMatch(/^partial\n\n\[answer truncated at 16384/);
  });

  it('explains when the whole budget went to thinking and no text came back', async () => {
    mockFinalMessage.mockResolvedValue({
      stop_reason: 'max_tokens',
      content: [{ type: 'thinking', thinking: '' }],
    });

    const answer = await new AnthropicCodeAssistantService(configWith({})).ask({
      prompt: 'x',
    });

    expect(answer).toMatch(/spent the whole 16384-token budget thinking/);
  });

  it('asks for adaptive thinking with a 16k budget and a timeout under the Vercel cap', async () => {
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
      maxRetries: 1,
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

    expect(answer).toBe('Claude declined to answer this request: policy');
  });
});
