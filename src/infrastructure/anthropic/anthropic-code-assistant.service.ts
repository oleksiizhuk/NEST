import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  IAskRequest,
  ICodeAssistantService,
} from '@application/mcp/code-assistant.service.interface';

const DEFAULT_MODEL = 'claude-opus-5';
// The answer is relayed back into an IDE chat, so it has to finish inside
// one HTTP request (Vercel caps the function at 60s). 8k output tokens is
// plenty for a code review or a snippet and keeps the call inside that window.
const MAX_TOKENS = 8192;

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
  private readonly model: string;
  private readonly effort: Effort;

  constructor(configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: configService.get<string>('ANTHROPIC_KEY'),
    });
    this.model = configService.get<string>('MCP_AI_MODEL') || DEFAULT_MODEL;
    this.effort = AnthropicCodeAssistantService.parseEffort(
      configService.get<string>('MCP_AI_EFFORT'),
    );
  }

  async ask({ prompt, context }: IAskRequest): Promise<string> {
    const content: Anthropic.ContentBlockParam[] = [];
    if (context) {
      content.push({ type: 'text', text: `<context>\n${context}\n</context>` });
    }
    content.push({ type: 'text', text: prompt });

    // Streaming so a long answer cannot trip the SDK's request timeout;
    // finalMessage() collects it into one Message
    const response = await this.client.messages
      .stream({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: { effort: this.effort },
        messages: [{ role: 'user', content }],
      })
      .finalMessage();

    if (response.stop_reason === 'refusal') {
      const why = response.stop_details?.explanation;
      this.logger.warn(
        `Claude refused the request: ${why ?? 'no explanation'}`,
      );
      return `Claude declined to answer this request${why ? `: ${why}` : '.'}`;
    }

    const text = this.extractText(response);
    if (response.stop_reason === 'max_tokens') {
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

  private static parseEffort(value?: string): Effort {
    return EFFORT_LEVELS.includes(value as Effort)
      ? (value as Effort)
      : DEFAULT_EFFORT;
  }
}
