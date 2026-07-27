import TelegramBot = require('node-telegram-bot-api');
import { IncomingTelegramMessage } from '@application/telegram/incoming-telegram-message';

export const mapToIncoming = (
  msg: TelegramBot.Message,
): IncomingTelegramMessage | null => {
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
