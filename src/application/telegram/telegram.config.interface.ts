export const TELEGRAM_CONFIG = 'TELEGRAM_CONFIG';

export type TelegramMode = 'polling' | 'webhook';

export interface ITelegramConfig {
  ownerId: number;
  allowedChatIds: number[];
  mode: TelegramMode;
  webhookSecret: string;
}
