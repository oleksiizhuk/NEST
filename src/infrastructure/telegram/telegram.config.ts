import { ConfigService } from '@nestjs/config';
import {
  ITelegramConfig,
  TelegramMode,
} from '@application/telegram/telegram.config.interface';

export const telegramConfig = (
  configService: ConfigService,
): ITelegramConfig => {
  const mode: TelegramMode =
    configService.get<string>('TELEGRAM_MODE') === 'polling'
      ? 'polling'
      : 'webhook';

  return {
    ownerId: Number(configService.get<string>('TELEGRAM_OWNER_ID')),
    // Comma-separated list; a single id still works unchanged
    allowedChatIds: (
      configService.get<string>('TELEGRAM_ALLOWED_CHAT_ID') ?? ''
    )
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id !== 0),
    mode,
    webhookSecret: configService.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? '',
  };
};
