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
}
