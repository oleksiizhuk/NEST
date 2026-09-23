import { TelegramMessage } from '@domain/telegram/telegram-message.entity';

export const TELEGRAM_MESSAGE_REPOSITORY = 'TELEGRAM_MESSAGE_REPOSITORY';

export type TelegramMessageLog = Omit<
  TelegramMessage,
  'id' | 'createdAt' | 'mode'
> & {
  mode?: string | null;
  // Tokens, time and tools of a project-manager answer
  usage?: Record<string, unknown> | null;
  // Carried by the 👍/👎 buttons under the answer
  feedbackToken?: string | null;
};

export interface AnswerRecord {
  createdAt: Date;
  chatId: number;
  question: string | null;
  usage: Record<string, unknown> | null;
  // 1 = 👍, -1 = 👎, null = no vote
  vote: number | null;
}

export interface ITelegramMessageRepository {
  save(data: TelegramMessageLog): Promise<TelegramMessage>;
  findByChatId(chatId: number, limit: number): Promise<TelegramMessage[]>;
  // False when no answer in that chat carries the token, or it was already
  // rated (the first vote sticks)
  setFeedback(
    token: string,
    chatId: number,
    vote: 1 | -1,
    userId: number,
  ): Promise<boolean>;
  // Newest project-manager answers that have usage recorded
  recentAnswers(limit: number): Promise<AnswerRecord[]>;
}
