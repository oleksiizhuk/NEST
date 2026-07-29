export const TELEGRAM_CONFIG = 'TELEGRAM_CONFIG';

export type TelegramMode = 'polling' | 'webhook';

export interface ITelegramConfig {
  ownerId: number;
  allowedChatIds: number[];
  mode: TelegramMode;
  webhookSecret: string;
  // Replies written before this are kept out of the model's context, so an
  // old persona cannot leak back in through the bot's own history
  historySince: Date | null;
}
