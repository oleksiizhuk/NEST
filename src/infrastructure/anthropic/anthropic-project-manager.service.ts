import { Injectable, Logger } from '@nestjs/common';
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
// Telegram waits on the webhook and Vercel stops at 300 s; leave room for
// fetching the snapshot and sending the reply.
const REQUEST_TIMEOUT_MS = 200_000;
const CHAT_MAX_TOKENS = 12_000;
const DIGEST_MAX_TOKENS = 16_000;

export const PM_UNAVAILABLE_REPLY =
  'Не получилось подготовить ответ — попробуйте ещё раз чуть позже.';

const parseEffort = (value: string | undefined, fallback: Effort): Effort =>
  EFFORTS.includes(value as Effort) ? (value as Effort) : fallback;

@Injectable()
export class AnthropicProjectManagerService
  implements IProjectManagerAiService
{
  private readonly logger = new Logger(AnthropicProjectManagerService.name);
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly chatEffort: Effort;
  private readonly digestEffort: Effort;

  constructor(config: ConfigService) {
    this.client = new Anthropic({
      apiKey: config.get<string>('ANTHROPIC_KEY'),
      timeout: REQUEST_TIMEOUT_MS,
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

  answer(request: PmRequest): Promise<string> {
    return this.call(request, this.chatEffort, CHAT_MAX_TOKENS, 'answer');
  }

  digest(request: Omit<PmRequest, 'history'>): Promise<string> {
    return this.call(
      { ...request, history: [] },
      this.digestEffort,
      DIGEST_MAX_TOKENS,
      'digest',
    );
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
      // Instructions first, then brief + snapshot as one cached block: it is
      // identical for every question until the next refresh, and a 1 h TTL
      // suits a chat where questions come in bursts.
      system: [
        { type: 'text', text: PROJECT_MANAGER_SYSTEM_PROMPT },
        {
          type: 'text',
          text: `<brief>\n${
            request.brief || '(no brief provided)'
          }\n</brief>\n\n${request.snapshot}`,
          cache_control: { type: 'ephemeral', ttl: '1h' },
        },
      ],
      // Thinking cannot be disabled on Opus 5.5; effort is the only dial
      thinking: { type: 'adaptive' },
      output_config: { effort },
      messages,
    };
  }

  private async call(
    request: PmRequest,
    effort: Effort,
    maxTokens: number,
    kind: string,
  ): Promise<string> {
    const startedAt = Date.now();
    const response = await this.client.messages
      .stream(this.buildParams(request, effort, maxTokens))
      .finalMessage();

    const usage = response.usage;
    this.logger.log(
      `pm ${kind}: ${this.model} effort=${effort} ${response.stop_reason} ` +
        `in=${usage?.input_tokens ?? '?'} cache_read=${
          usage?.cache_read_input_tokens ?? 0
        } cache_write=${usage?.cache_creation_input_tokens ?? 0} out=${
          usage?.output_tokens ?? '?'
        } ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );

    if (response.stop_reason === 'refusal') {
      this.logger.warn('The model declined the request');
      return PM_UNAVAILABLE_REPLY;
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim();
    return text || PM_UNAVAILABLE_REPLY;
  }
}
