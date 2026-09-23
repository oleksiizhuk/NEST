import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import type { CallbackQuery, Message } from 'grammy/types';
import {
  IBotInfo,
  InlineButton,
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
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly token: string;
  private client: Bot | null = null;
  private botInfo: Promise<IBotInfo> | null = null;

  constructor(configService: ConfigService) {
    this.token = configService.get<string>('TELEGRAM_TOKEN') ?? '';
  }

  // Created on first use: grammY throws on an empty token, and the app must
  // still boot where TELEGRAM_TOKEN is not set. No I/O happens here either,
  // which keeps serverless cold starts cheap.
  private get bot(): Bot {
    if (!this.client) this.client = new Bot(this.token);
    return this.client;
  }

  getBotInfo(): Promise<IBotInfo> {
    if (!this.botInfo) {
      this.botInfo = this.bot.api
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
  async sendMessage(
    chatId: number,
    text: string,
    buttons?: InlineButton[][],
  ): Promise<void> {
    const chunks = splitForTelegram(text);
    for (const [i, chunk] of chunks.entries()) {
      const last = i === chunks.length - 1;
      await this.bot.api.sendMessage(
        chatId,
        chunk,
        last && buttons?.length
          ? {
              reply_markup: {
                inline_keyboard: buttons.map((row) =>
                  row.map((b) => ({ text: b.text, callback_data: b.data })),
                ),
              },
            }
          : undefined,
      );
    }
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.bot.api.answerCallbackQuery(
      callbackId,
      text ? { text } : undefined,
    );
  }

  async clearButtons(chatId: number, messageId: number): Promise<void> {
    await this.bot.api.editMessageReplyMarkup(chatId, messageId, {
      reply_markup: { inline_keyboard: [] },
    });
  }

  async sendTyping(chatId: number): Promise<void> {
    await this.bot.api.sendChatAction(chatId, 'typing');
  }

  // Points Telegram at our webhook with the shared secret. Idempotent, so it
  // is safe on every cold start. Returns what Telegram reported before the
  // change, for the log.
  async registerWebhook(
    url: string,
    secret: string,
  ): Promise<{ url: string; pending: number; lastError: string | null }> {
    const before = await this.bot.api.getWebhookInfo();
    await this.bot.api.setWebhook(url, {
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    });
    return {
      url: before.url,
      pending: before.pending_update_count,
      lastError: before.last_error_message ?? null,
    };
  }

  // Local long polling only; production receives updates on the webhook.
  onMessage(handler: (message: Message) => void): void {
    this.bot.on('message', (ctx) => handler(ctx.message));
  }

  onCallback(handler: (query: CallbackQuery) => void): void {
    this.bot.on('callback_query', (ctx) => handler(ctx.callbackQuery));
  }

  // bot.start() resolves only when polling stops, so it runs in the
  // background and its failures are logged instead of killing the app.
  startPolling(): void {
    this.bot
      .start({ drop_pending_updates: false })
      .catch((error) =>
        this.logger.error(`Telegram polling stopped: ${error}`),
      );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isRunning()) {
      await this.client.stop();
    }
  }
}
