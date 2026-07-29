import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot = require('node-telegram-bot-api');
import {
  IBotInfo,
  ITelegramGateway,
} from '@application/telegram/telegram.gateway.interface';

// Telegram's hard limit is 4096; leave room so a split never lands on the edge
const CHUNK_LIMIT = 4000;

// Prefer paragraph, then line, then word boundaries — a chunk cut mid-word
// reads as a broken message
export const splitForTelegram = (text: string): string[] => {
  const rest = text.trim();
  if (rest.length <= CHUNK_LIMIT) return rest ? [rest] : [];

  const chunks: string[] = [];
  let remaining = rest;
  while (remaining.length > CHUNK_LIMIT) {
    const window = remaining.slice(0, CHUNK_LIMIT);
    const cut = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' '),
    );
    const at = cut > CHUNK_LIMIT / 2 ? cut : CHUNK_LIMIT;
    chunks.push(remaining.slice(0, at).trim());
    remaining = remaining.slice(at).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

@Injectable()
export class TelegramBotService implements ITelegramGateway, OnModuleDestroy {
  readonly bot: TelegramBot;
  private botInfo: Promise<IBotInfo> | null = null;
  private pollingStarted = false;

  constructor(configService: ConfigService) {
    // polling: false — no I/O in the constructor, safe for serverless cold starts
    this.bot = new TelegramBot(
      configService.get<string>('TELEGRAM_TOKEN') ?? '',
      { polling: false },
    );
  }

  getBotInfo(): Promise<IBotInfo> {
    if (!this.botInfo) {
      this.botInfo = this.bot
        .getMe()
        .then((me) => ({ id: me.id, username: me.username ?? '' }))
        .catch((error) => {
          this.botInfo = null;
          throw error;
        });
    }
    return this.botInfo;
  }

  // Telegram rejects anything past 4096 characters with a 400, which used to
  // lose the whole reply. No parse_mode is set, so the persona's asterisks and
  // underscores cannot break formatting mid-chunk.
  async sendMessage(chatId: number, text: string): Promise<void> {
    for (const chunk of splitForTelegram(text)) {
      await this.bot.sendMessage(chatId, chunk);
    }
  }

  async sendTyping(chatId: number): Promise<void> {
    await this.bot.sendChatAction(chatId, 'typing');
  }

  async startPolling(): Promise<void> {
    this.pollingStarted = true;
    await this.bot.startPolling();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollingStarted) {
      await this.bot.stopPolling();
    }
  }
}
