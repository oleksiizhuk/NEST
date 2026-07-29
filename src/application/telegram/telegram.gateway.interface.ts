export const TELEGRAM_GATEWAY = 'TELEGRAM_GATEWAY';

export interface IBotInfo {
  id: number;
  username: string;
}

export interface ITelegramGateway {
  sendMessage(chatId: number, text: string): Promise<void>;
  sendTyping(chatId: number): Promise<void>;
  getBotInfo(): Promise<IBotInfo>;
}
