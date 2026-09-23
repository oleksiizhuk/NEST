export const PM_ALERT_LOG = 'PM_ALERT_LOG';

// Remembers which alerts went to which chat, so each is sent once
export interface IAlertLog {
  // True the first time for this chat + key; false if already sent
  claim(chatId: number, key: string, now: Date): Promise<boolean>;
  // Undo claims whose message did not go out, so the next run retries
  release(chatId: number, keys: string[]): Promise<void>;
  // Forget claims under a prefix that are no longer active (a pipeline that
  // went green), so the next occurrence alerts again
  releaseStale(chatId: number, prefix: string, active: string[]): Promise<void>;
}
