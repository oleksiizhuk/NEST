import { ConfigService } from '@nestjs/config';
import {
  ITelegramConfig,
  TelegramMode,
} from '@application/telegram/telegram.config.interface';

// An unparseable value must not silently wipe the bot's memory — fall back to
// "no cutoff" and let the operator notice the history is still there
const parseDate = (value?: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const telegramConfig = (
  configService: ConfigService,
): ITelegramConfig => {
  const mode: TelegramMode =
    configService.get<string>('TELEGRAM_MODE') === 'polling'
      ? 'polling'
      : 'webhook';

  return {
    ownerId: Number(configService.get<string>('TELEGRAM_OWNER_ID')),
    mode,
    webhookSecret: configService.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? '',
    historySince: parseDate(
      configService.get<string>('TELEGRAM_HISTORY_SINCE'),
    ),
  };
};
