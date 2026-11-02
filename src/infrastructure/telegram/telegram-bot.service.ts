import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import type { CallbackQuery, Message, MessageEntity } from 'grammy/types';
import {
  IBotInfo,
  InlineButton,
  ITelegramGateway,
} from '@application/telegram/telegram.gateway.interface';
import {
  JiraLinkConfig,
  linkEntities,
} from '@infrastructure/telegram/telegram-links';

// Telegram's hard limit is 4096; leave room so a split never lands on the edge
const CHUNK_LIMIT = 4000;
const MESSAGE_LIMIT = 4096;

const keyboard = (buttons: InlineButton[][]) => ({
  inline_keyboard: buttons.map((row) =>
    row.map((b) => ({ text: b.text, callback_data: b.data })),
  ),
});

// Telegram's flood control answers 429 with parameters.retry_after
// (seconds); anything else is not a rate limit
export const retryAfterSeconds = (error: unknown): number | null => {
  const e = error as {
    error_code?: number;
    parameters?: { retry_after?: number };
  } | null;
  return e?.error_code === 429 ? e.parameters?.retry_after ?? 1 : null;
};

// Longer than this and a retry would not fit the cold start's time budget
const MAX_RETRY_WAIT_S = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const jiraOrigin = (value: string | undefined): string | null => {
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
};

@Injectable()
export class TelegramBotService implements ITelegramGateway, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly token: string;
  private client: Bot | null = null;
  private botInfo: Promise<IBotInfo> | null = null;
  private readonly jira: JiraLinkConfig;

  constructor(configService: ConfigService) {
    this.token = configService.get<string>('TELEGRAM_TOKEN') ?? '';
    // Ticket keys of these projects become links to the ticket
    this.jira = {
      baseUrl: jiraOrigin(
        configService.get<string>('PM_ATLASSIAN_BASE_URL') ||
          configService.get<string>('JIRA_BASE_URL'),
      ),
      projects: (configService.get<string>('PM_JIRA_PROJECTS') ?? '')
        .split(',')
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean),
    };
  }

  // A message whose links Telegram refuses still goes out, as plain text
  private async send(
    chatId: number,
    text: string,
    extra: { reply_markup?: ReturnType<typeof keyboard> } = {},
    links = true,
  ): Promise<Message.TextMessage> {
    const entities = links ? linkEntities(text, this.jira) : [];
    if (!entities.length) return this.bot.api.sendMessage(chatId, text, extra);
    try {
      return await this.bot.api.sendMessage(chatId, text, {
        ...extra,
        entities: entities as MessageEntity[],
      });
    } catch (error) {
      if (!/entit/i.test(String(error))) throw error;
      this.logger.warn(`links dropped: ${error}`);
      return this.bot.api.sendMessage(chatId, text, extra);
    }
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
    options?: { links?: boolean },
  ): Promise<void> {
    const chunks = splitForTelegram(text);
    for (const [i, chunk] of chunks.entries()) {
      const last = i === chunks.length - 1;
      await this.send(
        chatId,
        chunk,
        last && buttons?.length ? { reply_markup: keyboard(buttons) } : {},
        options?.links !== false,
      );
    }
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.bot.api.answerCallbackQuery(
      callbackId,
      text ? { text } : undefined,
    );
  }

  async isMember(chatId: number, userId: number): Promise<boolean> {
    const member = await this.bot.api.getChatMember(chatId, userId);
    return (
      member.status === 'creator' ||
      member.status === 'administrator' ||
      member.status === 'member' ||
      (member.status === 'restricted' && member.is_member)
    );
  }

  async clearButtons(chatId: number, messageId: number): Promise<void> {
    await this.bot.api.editMessageReplyMarkup(chatId, messageId, {
      reply_markup: { inline_keyboard: [] },
    });
  }

  // A checklist must stay one message: its buttons are edited later by
  // message id, so a split would leave items without their text
  async sendWithButtons(
    chatId: number,
    text: string,
    buttons: InlineButton[][],
  ): Promise<number> {
    if (text.length > MESSAGE_LIMIT)
      throw new Error(
        `Message of ${text.length} chars is over Telegram's ${MESSAGE_LIMIT}`,
      );
    const sent = await this.send(chatId, text, {
      reply_markup: keyboard(buttons),
    });
    return sent.message_id;
  }

  async setButtons(
    chatId: number,
    messageId: number,
    buttons: InlineButton[][],
  ): Promise<void> {
    await this.bot.api.editMessageReplyMarkup(chatId, messageId, {
      reply_markup: keyboard(buttons),
    });
  }

  async sendTyping(chatId: number): Promise<void> {
    await this.bot.api.sendChatAction(chatId, 'typing');
  }

  // Points Telegram at our webhook with the shared secret. Idempotent, so it
  // is safe on every cold start. Returns what Telegram reported before the
  // change, for the log.
  //
  // A fresh deployment starts several instances at once and each one calls
  // setWebhook; Telegram lets one through and answers the rest 429 with a
  // retry_after. Such an instance waits that long (with jitter) and tries
  // once more; still refused, it reads the webhook back: `rateLimited` says
  // its own call never landed, `registered` whether the webhook points at
  // this URL anyway (another instance set it).
  async registerWebhook(
    url: string,
    secret: string,
  ): Promise<{
    url: string;
    pending: number;
    lastError: string | null;
    rateLimited: boolean;
    registered: boolean;
  }> {
    const before = await this.bot.api.getWebhookInfo();
    const info = {
      url: before.url,
      pending: before.pending_update_count,
      lastError: before.last_error_message ?? null,
    };
    for (let attempt = 0; ; attempt++) {
      try {
        await this.bot.api.setWebhook(url, {
          secret_token: secret,
          allowed_updates: ['message', 'callback_query'],
        });
        return { ...info, rateLimited: false, registered: true };
      } catch (error) {
        const wait = retryAfterSeconds(error);
        if (wait === null) throw error;
        if (attempt >= 1 || wait > MAX_RETRY_WAIT_S) break;
        await sleep(wait * 1000 + Math.random() * 500);
      }
    }
    const now = await this.bot.api.getWebhookInfo();
    return { ...info, rateLimited: true, registered: now.url === url };
  }

  // The command menu of one private chat (the owner's), so commands only the
  // owner may use are not shown to anyone else. Written only when it
  // differs; returns whether it was.
  async setChatCommands(
    chatId: number,
    commands: Array<{ command: string; description: string }>,
  ): Promise<boolean> {
    const scope = { type: 'chat' as const, chat_id: chatId };
    const current = await this.bot.api.getMyCommands({ scope });
    const same =
      current.length === commands.length &&
      current.every(
        (c, i) =>
          c.command === commands[i].command &&
          c.description === commands[i].description,
      );
    if (same) return false;
    await this.bot.api.setMyCommands(commands, { scope });
    return true;
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
