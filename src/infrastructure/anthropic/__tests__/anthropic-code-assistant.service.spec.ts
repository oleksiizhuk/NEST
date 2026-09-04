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

  it('honours MCP_AI_MODEL and MCP_AI_EFFORT, ignoring an unknown effort', async () => {
    mockFinalMessage.mockResolvedValue(textMessage('ok'));

    await new AnthropicCodeAssistantService(
      configWith({ MCP_AI_MODEL: 'claude-sonnet-5', MCP_AI_EFFORT: 'low' }),
    ).ask({ prompt: 'a' });
    await new AnthropicCodeAssistantService(
      configWith({ MCP_AI_EFFORT: 'turbo' }),
    ).ask({ prompt: 'b' });

    const [first, second] = mockStream.mock.calls.map((c) => c[0] as any);
    expect(first.model).toBe('claude-sonnet-5');
    expect(first.output_config).toEqual({ effort: 'low' });
    expect(second.output_config).toEqual({ effort: 'high' });
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

    expect(answer).toMatch(/^partial\n\n\[answer truncated/);
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
