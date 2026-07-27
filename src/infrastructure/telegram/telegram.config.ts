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
    allowedChatId: Number(
      configService.get<string>('TELEGRAM_ALLOWED_CHAT_ID'),
    ),
    mode,
    webhookSecret: configService.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? '',
  };
};
