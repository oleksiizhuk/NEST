import type { CallbackQuery, Message } from 'grammy/types';
import { IncomingTelegramMessage } from '@application/telegram/incoming-telegram-message';

export const mapToIncoming = (msg: Message): IncomingTelegramMessage | null => {
  if (!msg.from) return null;

  return {
    chatId: msg.chat.id,
    chatType: msg.chat.type,
    chatTitle: msg.chat.title ?? null,
    text: msg.text ?? null,
    from: {
      id: msg.from.id,
      username: msg.from.username ?? null,
      firstName: msg.from.first_name ?? null,
      lastName: msg.from.last_name ?? null,
    },
    replyToBotId: msg.reply_to_message?.from?.id,
  };
};

// Callback data written by the bot: "c:<id>" confirm, "x:<id>" cancel,
// "o:<n>" the n-th option. An option's meaning is its button label, read
// back from the message itself, so nothing has to be stored for it.
const ACTION_ID = /^[A-Z0-9]{1,16}$/i;

export const mapCallbackToIncoming = (
  query: CallbackQuery,
): IncomingTelegramMessage | null => {
  const message = query.message;
  const data = query.data ?? '';
  if (!message || !data) return null;
  const [prefix, value = ''] = data.split(':', 2);

  let text: string;
  let kind: 'confirm' | 'cancel' | 'option';
  if ((prefix === 'c' || prefix === 'x') && ACTION_ID.test(value)) {
    kind = prefix === 'c' ? 'confirm' : 'cancel';
    text = `/${kind} ${value}`;
  } else if (prefix === 'o') {
    // An inaccessible (too old) message carries no keyboard
    const rows =
      'reply_markup' in message
        ? message.reply_markup?.inline_keyboard ?? []
        : [];
    const button = rows
      .flat()
      .find((b) => 'callback_data' in b && b.callback_data === data);
    if (!button) return null;
    kind = 'option';
    text = `Выбираю вариант: ${button.text}`;
  } else {
    return null;
  }

  return {
    chatId: message.chat.id,
    chatType: message.chat.type,
    chatTitle: 'title' in message.chat ? message.chat.title ?? null : null,
    text,
    from: {
      id: query.from.id,
      username: query.from.username ?? null,
      firstName: query.from.first_name ?? null,
      lastName: query.from.last_name ?? null,
    },
    callback: { id: query.id, messageId: message.message_id, kind },
  };
};
