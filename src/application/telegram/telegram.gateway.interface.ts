export const TELEGRAM_GATEWAY = 'TELEGRAM_GATEWAY';

export interface IBotInfo {
  id: number;
  username: string;
}

// One inline button; `data` comes back in the callback when it is pressed
// (Telegram caps it at 64 bytes)
export interface InlineButton {
  text: string;
  data: string;
}

export interface ITelegramGateway {
  // Buttons, when given, go under the last chunk of the message
  sendMessage(
    chatId: number,
    text: string,
    buttons?: InlineButton[][],
  ): Promise<void>;
  sendTyping(chatId: number): Promise<void>;
  getBotInfo(): Promise<IBotInfo>;
  // Stops the button's loading spinner; an optional short toast
  answerCallback(callbackId: string, text?: string): Promise<void>;
  // Removes the buttons so a choice cannot be pressed twice
  clearButtons(chatId: number, messageId: number): Promise<void>;
  // Whether that user is currently in the group
  isMember(chatId: number, userId: number): Promise<boolean>;
}
