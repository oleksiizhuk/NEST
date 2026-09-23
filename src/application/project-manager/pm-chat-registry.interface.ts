export const PM_CHAT_REGISTRY = 'PM_CHAT_REGISTRY';

// Chats the owner switched to project-manager mode from inside the chat
// (/pm_on), on top of the TELEGRAM_PM_CHAT_IDS list.
export interface IPmChatRegistry {
  isEnabled(chatId: number): Promise<boolean>;
  enable(chatId: number, title: string | null): Promise<void>;
  disable(chatId: number): Promise<void>;
  // Chats that also receive the weekday digest
  digestChats(): Promise<number[]>;
}
