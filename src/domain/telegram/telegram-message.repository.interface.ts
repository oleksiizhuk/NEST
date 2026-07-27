import { TelegramMessage } from '@domain/telegram/telegram-message.entity';

export const TELEGRAM_MESSAGE_REPOSITORY = 'TELEGRAM_MESSAGE_REPOSITORY';

export type TelegramMessageLog = Omit<TelegramMessage, 'id' | 'createdAt'>;

export interface ITelegramMessageRepository {
  save(data: TelegramMessageLog): Promise<TelegramMessage>;
  findByChatId(chatId: number, limit: number): Promise<TelegramMessage[]>;
}
