import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITelegramConfig,
  TELEGRAM_CONFIG,
} from '@application/telegram/telegram.config.interface';
import {
  retryAfterSeconds,
  TelegramBotService,
} from '@infrastructure/telegram/telegram-bot.service';

const REGISTER_TIMEOUT_MS = 5000;

// The menu in the owner's private chat. Only there: /report and /refresh
// are the owner's, and nobody else should see them offered.
export const OWNER_COMMANDS = [
  { command: 'status', description: 'Статус проекта: вердикт, фокус, риски' },
  { command: 'report', description: 'Отчёт по человеку из команды' },
  { command: 'refresh', description: 'Обновить данные из Jira, GitHub и др.' },
  { command: 'memory', description: 'Что бот помнит о проекте' },
  { command: 'admin', description: 'Ссылка на админку' },
];

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timed out')), REGISTER_TIMEOUT_MS),
    ),
  ]);

// Where Telegram should deliver updates: TELEGRAM_WEBHOOK_URL if set,
// otherwise the project's production domain that Vercel exposes.
export const resolveWebhookUrl = (config: ConfigService): string | null => {
  const explicit = config.get<string>('TELEGRAM_WEBHOOK_URL');
  if (explicit) return explicit;
  const host = config.get<string>('VERCEL_PROJECT_PRODUCTION_URL');
  return host ? `https://${host}/telegram/webhook` : null;
};

// Keeps the production webhook registered. A webhook can silently disappear
// (a local polling run with the same token deletes it), and then the bot
// just stops answering; re-registering on every production cold start
// heals that with the next deploy or instance.
@Injectable()
export class TelegramWebhookBootstrap implements OnModuleInit {
  private readonly logger = new Logger(TelegramWebhookBootstrap.name);

  constructor(
    private readonly botService: TelegramBotService,
    private readonly configService: ConfigService,
    @Inject(TELEGRAM_CONFIG) private readonly config: ITelegramConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    // Previews share the bot token; only production may own the webhook.
    if (this.configService.get<string>('VERCEL_ENV') !== 'production') return;
    if (this.config.mode !== 'webhook') return;
    if (!this.configService.get<string>('TELEGRAM_TOKEN')) return;

    const url = resolveWebhookUrl(this.configService);
    if (!url || !this.config.webhookSecret) {
      this.logger.warn(
        'Telegram webhook not registered: set TELEGRAM_WEBHOOK_SECRET and TELEGRAM_WEBHOOK_URL (or expose VERCEL_PROJECT_PRODUCTION_URL)',
      );
      return;
    }

    // Side by side, so the menu adds no time to a cold start
    await Promise.all([this.registerWebhook(url), this.setOwnerMenu()]);
  }

  private async registerWebhook(url: string): Promise<void> {
    try {
      const before = await withTimeout(
        this.botService.registerWebhook(url, this.config.webhookSecret),
      );
      if (before.rateLimited) {
        // Several instances of a new deployment register at once; Telegram
        // let another one through. Only a webhook that is not ours is a fault
        if (before.registered)
          this.logger.log(
            `Telegram webhook already set to ${url} by another instance (this one was rate-limited)`,
          );
        else
          this.logger.error(
            `Telegram webhook not registered: rate-limited, and it points at ${
              before.url || 'none'
            }`,
          );
        return;
      }
      this.logger.log(
        `Telegram webhook set to ${url} (was: ${before.url || 'none'}, ` +
          `pending: ${before.pending}, last error: ${
            before.lastError ?? 'none'
          })`,
      );
    } catch (error) {
      // Never block the API on Telegram; the next cold start retries.
      this.logger.error(`Telegram webhook registration failed: ${error}`);
    }
  }

  private async setOwnerMenu(): Promise<void> {
    if (!this.config.ownerId) return;
    try {
      const changed = await withTimeout(
        this.botService.setChatCommands(this.config.ownerId, OWNER_COMMANDS),
      );
      if (changed) this.logger.log("Owner's command menu updated");
    } catch (error) {
      // Another instance of the same deployment is writing the same menu
      if (retryAfterSeconds(error) !== null)
        this.logger.log("Owner's command menu: another instance is setting it");
      // A missing menu only means typing the command; the next cold start retries
      else this.logger.warn(`Owner's command menu not set: ${error}`);
    }
  }
}
