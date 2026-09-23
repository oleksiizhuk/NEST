export const PM_ALERT_LOG = 'PM_ALERT_LOG';

// Remembers which alerts went to which chat, so each is sent once
export interface IAlertLog {
  // True the first time for this chat + key; false if already sent
  claim(chatId: number, key: string, now: Date): Promise<boolean>;
}
