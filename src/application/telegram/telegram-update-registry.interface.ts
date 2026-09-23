export const TELEGRAM_UPDATE_REGISTRY = 'TELEGRAM_UPDATE_REGISTRY';

export interface ITelegramUpdateRegistry {
  // True the first time an update id is seen, false for a retry of it
  claim(updateId: number): Promise<boolean>;
}
