import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ITelegramConfig,
  TELEGRAM_CONFIG,
} from '@application/telegram/telegram.config.interface';
import { TelegramBotService } from '@infrastructure/telegram/telegram-bot.service';

const REGISTER_TIMEOUT_MS = 5000;

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

    try {
      const before = await Promise.race([
        this.botService.registerWebhook(url, this.config.webhookSecret),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timed out')), REGISTER_TIMEOUT_MS),
        ),
      ]);
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
}
