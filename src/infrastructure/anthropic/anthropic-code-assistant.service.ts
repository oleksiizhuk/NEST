import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  ASSISTANT_MODELS,
  AssistantModel,
  DEFAULT_ASSISTANT_MODEL,
  IAskRequest,
  ICodeAssistantService,
} from '@application/mcp/code-assistant.service.interface';

// The short names an IDE picks from, resolved to Anthropic model ids.
// Bump the ids here when a new generation ships.
const MODEL_IDS: Record<AssistantModel, string> = {
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  fable: 'claude-fable-5-1',
};

// The answer is relayed back into an IDE chat, so it has to finish inside
// one HTTP request: Vercel cuts the function at 300s. Thinking is on by
// default on these models and its tokens count against max_tokens, so the
// budget must leave room for both the reasoning and the visible answer.
// 16k tokens is about 220s of output at Opus speed, which fits the window
// with margin; 8k was too small — a heavy review spent it all on thinking
// and came back empty.
const MAX_TOKENS = 16384;
// Give up on Anthropic before Vercel gives up on us, so the IDE gets a
// readable error instead of a 504 from the edge.
const REQUEST_TIMEOUT_MS = 250_000;

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT_LEVELS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_EFFORT: Effort = 'high';

const SYSTEM_PROMPT =
  'You are a senior software engineer answering questions relayed from a ' +
  "developer's IDE assistant over MCP. Answer directly and concretely: give " +
  'working code when code is asked for, name the exact file or symbol when ' +
  'you refer to one, and state assumptions instead of asking questions back ' +
  '(there is no follow-up turn). Prefer the smallest change that solves the ' +
  'problem. When context is provided, ground the answer in it and do not ' +
  'invent APIs that are not there. Reply in the language of the question.';

@Injectable()
export class AnthropicCodeAssistantService implements ICodeAssistantService {
  private readonly logger = new Logger(AnthropicCodeAssistantService.name);
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly effort: Effort;

  constructor(configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: configService.get<string>('ANTHROPIC_KEY'),
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
    this.defaultModel = AnthropicCodeAssistantService.resolveModel(
      configService.get<string>('MCP_AI_MODEL'),
    );
    this.effort = AnthropicCodeAssistantService.parseEffort(
      configService.get<string>('MCP_AI_EFFORT'),
    );
  }

  async ask({ prompt, context, model }: IAskRequest): Promise<string> {
    const modelId = model ? MODEL_IDS[model] : this.defaultModel;

    const content: Anthropic.ContentBlockParam[] = [];
    if (context) {
      content.push({ type: 'text', text: `<context>\n${context}\n</context>` });
    }
    content.push({ type: 'text', text: prompt });

    const startedAt = Date.now();
    this.logger.log(`ask_claude via ${modelId} (effort ${this.effort})`);

    // Streaming so a long answer cannot trip the SDK's request timeout;
    // finalMessage() collects it into one Message
    const response = await this.client.messages
      .stream({
        model: modelId,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
        messages: [{ role: 'user', content }],
      })
      .finalMessage();

    this.logger.log(
      `ask_claude done: ${modelId} ${response.stop_reason} ` +
        `in=${response.usage?.input_tokens ?? '?'} out=${
          response.usage?.output_tokens ?? '?'
        } ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );

    if (response.stop_reason === 'refusal') {
      const why = response.stop_details?.explanation;
      this.logger.warn(
        `Claude refused the request: ${why ?? 'no explanation'}`,
      );
      return `Claude declined to answer this request${why ? `: ${why}` : '.'}`;
    }

    const text = this.extractText(response);
    if (response.stop_reason === 'max_tokens') {
      if (!text) {
        return (
          `Claude spent the whole ${MAX_TOKENS}-token budget thinking and ` +
          'produced no answer. Ask a narrower question (one file, one ' +
          'problem) or send less context.'
        );
      }
      return `${text}\n\n[answer truncated at ${MAX_TOKENS} tokens — ask for a narrower piece]`;
    }
    return text;
  }

  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('\n\n')
      .trim();
  }

  // MCP_AI_MODEL is either one of the short names (opus, sonnet, fable) or a
  // raw Anthropic model id for anything not in the list
  private static resolveModel(value?: string): string {
    if (!value) {
      return MODEL_IDS[DEFAULT_ASSISTANT_MODEL];
    }
    return ASSISTANT_MODELS.includes(value as AssistantModel)
      ? MODEL_IDS[value as AssistantModel]
      : value;
  }

  private static parseEffort(value?: string): Effort {
    return EFFORT_LEVELS.includes(value as Effort)
      ? (value as Effort)
      : DEFAULT_EFFORT;
  }
}
