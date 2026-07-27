export class TelegramMessage {
  constructor(
    public readonly id: string,
    public readonly createdAt: Date,
    public userId: number,
    public username: string | null,
    public firstName: string | null,
    public lastName: string | null,
    public chatId: number,
    public chatType: string,
    public chatTitle: string | null,
    public text: string | null,
    public botResponse: string | null,
  ) {}
}
