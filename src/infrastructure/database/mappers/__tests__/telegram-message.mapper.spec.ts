import { TelegramMessageMapper } from '@infrastructure/database/mappers/telegram-message.mapper';
import { TelegramMessageDocument } from '@infrastructure/database/schemas/telegram-message.schema';

const createdAt = new Date('2026-07-27T12:00:00.000Z');

const mockDoc = {
  _id: 'message-id',
  createdAt,
  userId: 1,
  username: 'owner',
  firstName: 'Oleksii',
  lastName: null,
  chatId: -100,
  chatType: 'supergroup',
  chatTitle: 'Chat',
  text: 'Hello',
  botResponse: 'Reply',
} as unknown as TelegramMessageDocument;

describe('TelegramMessageMapper', () => {
  describe('toDomain', () => {
    it('maps all fields correctly', () => {
      const message = TelegramMessageMapper.toDomain(mockDoc);
      expect(message.id).toBe('message-id');
      expect(message.createdAt).toBe(createdAt);
      expect(message.userId).toBe(1);
      expect(message.username).toBe('owner');
      expect(message.firstName).toBe('Oleksii');
      expect(message.lastName).toBeNull();
      expect(message.chatId).toBe(-100);
      expect(message.chatType).toBe('supergroup');
      expect(message.chatTitle).toBe('Chat');
      expect(message.text).toBe('Hello');
      expect(message.botResponse).toBe('Reply');
    });
  });
});
