import { TelegramMessage } from '@domain/telegram/telegram-message.entity';
import { TelegramMessageDocument } from '@infrastructure/database/schemas/telegram-message.schema';

export class TelegramMessageMapper {
  static toDomain(doc: TelegramMessageDocument): TelegramMessage {
    return new TelegramMessage(
      String(doc._id),
      doc.createdAt,
      doc.userId,
      doc.username,
      doc.firstName,
      doc.lastName,
      doc.chatId,
      doc.chatType,
      doc.chatTitle,
      doc.text,
      doc.botResponse,
    );
  }
}
