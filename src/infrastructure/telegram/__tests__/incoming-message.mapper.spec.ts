import type { CallbackQuery } from 'grammy/types';
import { mapCallbackToIncoming } from '@infrastructure/telegram/incoming-message.mapper';

const query = (data: string, keyboard = true): CallbackQuery =>
  ({
    id: 'cb1',
    data,
    chat_instance: 'x',
    from: { id: 7, is_bot: false, first_name: 'Dev', username: 'dev' },
    message: {
      message_id: 99,
      date: 1,
      chat: { id: -100, type: 'supergroup', title: 'Team' },
      ...(keyboard
        ? {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Galleria, Riyadh', callback_data: 'o:0' }],
                [{ text: 'Park Avenue', callback_data: 'o:1' }],
              ],
            },
          }
        : {}),
    },
  } as unknown as CallbackQuery);

describe('mapCallbackToIncoming', () => {
  it('turns Confirm and Cancel presses into the matching commands', () => {
    expect(mapCallbackToIncoming(query('c:K7Q2A'))).toMatchObject({
      chatId: -100,
      chatType: 'supergroup',
      text: '/confirm K7Q2A',
      from: { id: 7, username: 'dev' },
      callback: { id: 'cb1', messageId: 99, kind: 'confirm' },
    });
    expect(mapCallbackToIncoming(query('x:K7Q2A'))?.text).toBe('/cancel K7Q2A');
  });

  it('reads an option label back from the pressed message', () => {
    expect(mapCallbackToIncoming(query('o:1'))).toMatchObject({
      text: 'Выбираю вариант: Park Avenue',
      callback: { kind: 'option' },
    });
  });

  it('reads a feedback vote and its token', () => {
    expect(mapCallbackToIncoming(query('f:-:abc123def456'))).toMatchObject({
      text: '👎',
      callback: { kind: 'feedback', vote: -1, token: 'abc123def456' },
    });
    expect(mapCallbackToIncoming(query('f:+:bad token'))).toBeNull();
  });

  it('reads an admin login approval', () => {
    const id = 'a'.repeat(32);
    expect(mapCallbackToIncoming(query(`a:-:${id}`))).toMatchObject({
      callback: { kind: 'approve', approve: false, token: id },
    });
    expect(mapCallbackToIncoming(query('a:+:short'))).toBeNull();
  });

  it('drops unknown data, bad ids and options it cannot read', () => {
    expect(mapCallbackToIncoming(query('z:1'))).toBeNull();
    expect(mapCallbackToIncoming(query('c:K7 Q2A; rm'))).toBeNull();
    expect(mapCallbackToIncoming(query('o:5'))).toBeNull();
    expect(mapCallbackToIncoming(query('o:0', false))).toBeNull();
  });
});
