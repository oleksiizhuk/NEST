import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { IAiReplyService } from '@application/telegram/ai-reply.service.interface';
import { TELEGRAM_SYSTEM_PROMPT } from '@infrastructure/telegram/telegram.system-prompt';

const DEFAULT_MODEL = 'claude-sonnet-5';

@Injectable()
export class AnthropicReplyService implements IAiReplyService {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: configService.get<string>('ANTHROPIC_KEY'),
    });
    this.model =
      configService.get<string>('TELEGRAM_AI_MODEL') || DEFAULT_MODEL;
  }

  async generateReply(userText: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      // thinking would eat into the 1024-token budget for a chat bot
      thinking: { type: 'disabled' },
      system: TELEGRAM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    });

    const block = response.content.find((b) => b.type === 'text');
    return block && 'text' in block ? block.text : '';
  }
}
