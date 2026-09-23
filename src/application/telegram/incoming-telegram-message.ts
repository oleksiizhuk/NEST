export interface IncomingTelegramMessage {
  chatId: number;
  chatType: string;
  chatTitle: string | null;
  text: string | null;
  from: {
    id: number;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  replyToBotId?: number;
  // Set when this "message" is a press on one of the bot's inline buttons;
  // `text` then holds what the press means (a command or the chosen option)
  callback?: {
    id: string;
    messageId: number;
    kind: 'confirm' | 'cancel' | 'option' | 'feedback' | 'approve';
    // For feedback: 👍 = 1, 👎 = -1, and the answer's token
    vote?: 1 | -1;
    token?: string;
    // For approve: the owner's answer to an admin login
    approve?: boolean;
  };
}
