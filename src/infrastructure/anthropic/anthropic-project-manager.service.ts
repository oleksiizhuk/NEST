import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  IProjectManagerAiService,
  PmRequest,
} from '@application/project-manager/project-manager-ai.interface';
import { PROJECT_MANAGER_SYSTEM_PROMPT } from '@infrastructure/anthropic/project-manager.system-prompt';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_MODEL = 'claude-opus-5-5';
const CHAT_MAX_TOKENS = 12_000;
const DIGEST_MAX_TOKENS = 16_000;
// Telegram waits on the webhook and Vercel stops at 300 s
const DEFAULT_BUDGET_MS = 240_000;
const RESERVE_FOR_FINAL_MS = 50_000;
const MAX_ITERATIONS = 8;
const MAX_TOOL_CALLS = 16;
const TOOL_TIMEOUT_MS = 15_000;
const MAX_TOOL_CHARS_PER_TURN = 150_000;

export const PM_UNAVAILABLE_REPLY =
  'Не получилось подготовить ответ — попробуйте ещё раз чуть позже.';

const WRAP_UP =
  'Tool budget or time is used up. Answer now from what you already have, and say briefly what you could not check.';

const parseEffort = (value: string | undefined, fallback: Effort): Effort =>
  EFFORTS.includes(value as Effort) ? (value as Effort) : fallback;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

@Injectable()
export class AnthropicProjectManagerService
  implements IProjectManagerAiService
{
  private readonly logger = new Logger(AnthropicProjectManagerService.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly chatEffort: Effort;
  private readonly digestEffort: Effort;

  // The client parameter exists for tests only; Nest leaves it undefined
  constructor(config: ConfigService, @Optional() client?: Anthropic) {
    this.client =
      client ??
      new Anthropic({
        apiKey: config.get<string>('ANTHROPIC_KEY'),
        maxRetries: 0,
      });
    this.model = config.get<string>('PM_AI_MODEL') || DEFAULT_MODEL;
    // Opus 5.5 defaults to medium when effort is omitted; always send it
    this.chatEffort = parseEffort(config.get<string>('PM_AI_EFFORT'), 'high');
    this.digestEffort = parseEffort(
      config.get<string>('PM_DIGEST_EFFORT'),
      'high',
    );
  }

  system(request: Pick<PmRequest, 'brief' | 'knowledge' | 'snapshot'>) {
    // Two 1 h breakpoints: tools + instructions + knowledge change rarely;
    // brief + snapshot change once a day. Order matters for the cache.
    return [
      { type: 'text' as const, text: PROJECT_MANAGER_SYSTEM_PROMPT },
      {
        type: 'text' as const,
        text: `<knowledge>\n${request.knowledge || '(none)'}\n</knowledge>`,
        cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
      },
      {
        type: 'text' as const,
        text: `<brief>\n${
          request.brief || '(no brief provided)'
        }\n</brief>\n\n${request.snapshot}`,
        cache_control: { type: 'ephemeral' as const, ttl: '1h' as const },
      },
    ];
  }

  buildParams(
    request: PmRequest,
    effort: Effort,
    maxTokens: number,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const messages: Anthropic.MessageParam[] = [];
    for (const turn of request.history) {
      messages.push({ role: 'user', content: turn.userText });
      messages.push({ role: 'assistant', content: turn.botResponse });
    }
    messages.push({ role: 'user', content: request.question });
    return {
      model: this.model,
      max_tokens: maxTokens,
      system: this.system(request),
      ...(request.tools?.specs.length
        ? { tools: request.tools.specs as Anthropic.Tool[] }
        : {}),
      // Thinking cannot be disabled on Opus 5.5; effort is the only dial
      thinking: { type: 'adaptive' },
      output_config: { effort },
      messages,
    };
  }

  async digest(request: Omit<PmRequest, 'history' | 'tools'>): Promise<string> {
    const response = await this.create(
      this.buildParams(
        { ...request, history: [] },
        this.digestEffort,
        DIGEST_MAX_TOKENS,
      ),
      Date.now() + DEFAULT_BUDGET_MS,
      'digest',
    );
    return this.textOf(response) || PM_UNAVAILABLE_REPLY;
  }

  async answer(request: PmRequest): Promise<string> {
    const deadline = request.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
    const params = this.buildParams(request, this.chatEffort, CHAT_MAX_TOKENS);
    const messages = params.messages;
    let toolCalls = 0;
    let toolChars = 0;
    let lastText = '';

    for (let iteration = 0; ; iteration++) {
      const left = deadline - Date.now();
      const wrapUp =
        !request.tools ||
        iteration >= MAX_ITERATIONS ||
        toolCalls >= MAX_TOOL_CALLS ||
        toolChars >= MAX_TOOL_CHARS_PER_TURN ||
        left < RESERVE_FOR_FINAL_MS + 20_000;
      if (wrapUp && iteration > 0) this.appendUserText(messages, WRAP_UP);

      const response = await this.create(
        {
          ...params,
          messages,
          ...(params.tools
            ? { tool_choice: { type: wrapUp ? 'none' : 'auto' } }
            : {}),
          // Less thinking when the clock is short
          output_config: {
            effort: left < 90_000 ? 'medium' : this.chatEffort,
          },
        },
        deadline,
        `answer#${iteration}`,
      );

      if (response.stop_reason === 'refusal') return PM_UNAVAILABLE_REPLY;
      lastText = this.textOf(response) || lastText;
      if (response.stop_reason !== 'tool_use' || wrapUp || !request.tools) {
        return lastText || PM_UNAVAILABLE_REPLY;
      }

      // Thinking and tool_use blocks go back unchanged
      messages.push({ role: 'assistant', content: response.content });
      const calls = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      toolCalls += calls.length;
      const timeout = Math.max(
        3_000,
        Math.min(TOOL_TIMEOUT_MS, deadline - Date.now() - RESERVE_FOR_FINAL_MS),
      );
      const tools = request.tools;
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        calls.map(async (call) => {
          try {
            const output = await withTimeout(
              tools.run(
                call.name,
                (call.input ?? {}) as Record<string, unknown>,
              ),
              timeout,
            );
            toolChars += output.length;
            return {
              type: 'tool_result' as const,
              tool_use_id: call.id,
              content: output,
            };
          } catch (error) {
            return {
              type: 'tool_result' as const,
              tool_use_id: call.id,
              is_error: true,
              content: String((error as Error)?.message ?? error).slice(0, 500),
            };
          }
        }),
      );
      this.logger.log(
        `pm tools: ${calls
          .map((c) => c.name)
          .join(', ')} (${toolChars} chars so far)`,
      );
      messages.push({ role: 'user', content: results });
    }
  }

  private appendUserText(messages: Anthropic.MessageParam[], text: string) {
    const last = messages[messages.length - 1];
    if (last?.role === 'user' && Array.isArray(last.content)) {
      last.content = [...last.content, { type: 'text', text }];
    } else {
      messages.push({ role: 'user', content: text });
    }
  }

  private async create(
    params: Anthropic.MessageCreateParamsNonStreaming,
    deadline: number,
    kind: string,
  ): Promise<Anthropic.Message> {
    const startedAt = Date.now();
    const timeout = Math.max(10_000, deadline - startedAt);
    const response = await this.client.messages
      .stream(params, { timeout })
      .finalMessage();
    const usage = response.usage;
    this.logger.log(
      `pm ${kind}: ${this.model} ${response.stop_reason} in=${
        usage?.input_tokens ?? '?'
      } cache_read=${usage?.cache_read_input_tokens ?? 0} cache_write=${
        usage?.cache_creation_input_tokens ?? 0
      } out=${usage?.output_tokens ?? '?'} ${(
        (Date.now() - startedAt) /
        1000
      ).toFixed(1)}s`,
    );
    if (response.stop_reason === 'refusal') {
      this.logger.warn('The model declined the request');
    }
    return response;
  }

  private textOf(response: Anthropic.Message): string {
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim();
  }
}
