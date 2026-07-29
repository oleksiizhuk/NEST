import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import {
  IAiReplyService,
  IConversationTurn,
  AI_REPLY_SERVICE,
} from '@application/telegram/ai-reply.service.interface';
import {
  ITelegramConfig,
  TELEGRAM_CONFIG,
} from '@application/telegram/telegram.config.interface';
import {
  ITelegramMessageRepository,
  TELEGRAM_MESSAGE_REPOSITORY,
} from '@domain/telegram/telegram-message.repository.interface';
import { IncomingTelegramMessage } from '@application/telegram/incoming-telegram-message';

// "Оксана @oksana" — whatever Telegram gave us, falling back to the numeric id
const authorLabel = (from: {
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
}): string => {
  const name = [from.firstName, from.lastName].filter(Boolean).join(' ');
  const handle = from.username ? `@${from.username}` : '';
  return [name, handle].filter(Boolean).join(' ') || `id${from.id}`;
};

const FALLBACK_MESSAGE = 'Что-то пошло не так 😢';
const ERROR_PREFIX = 'ERROR: ';
// Exchanges (user + bot) replayed to the model as conversation context
const HISTORY_LIMIT = 10;

@Injectable()
export class HandleTelegramMessageUseCase {
  private readonly logger = new Logger(HandleTelegramMessageUseCase.name);

  constructor(
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(AI_REPLY_SERVICE) private readonly aiReply: IAiReplyService,
    @Inject(TELEGRAM_MESSAGE_REPOSITORY)
    private readonly messageRepository: ITelegramMessageRepository,
    @Inject(TELEGRAM_CONFIG) private readonly config: ITelegramConfig,
  ) {}

  async execute(msg: IncomingTelegramMessage): Promise<void> {
    const { chatId, chatType, text } = msg;
    if (!text) return;

    const isPrivate = chatType === 'private';
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    if (!isPrivate && !isGroup) return;

    if (isPrivate && msg.from.id !== this.config.ownerId) return;
    // Empty allowlist = any group the bot is added to; owner-only stays for DMs
    const groupAllowed =
      this.config.allowedChatIds.length === 0 ||
      this.config.allowedChatIds.includes(chatId);
    if (isGroup && !groupAllowed) return;

    const botInfo = await this.telegram.getBotInfo();

    if (isGroup) {
      const isMentioned = text
        .toLowerCase()
        .includes(`@${botInfo.username.toLowerCase()}`);
      const isReply = msg.replyToBotId === botInfo.id;
      if (!isMentioned && !isReply) return;
    }

    const cleanText = text
      .replace(new RegExp(`@${botInfo.username}`, 'gi'), '')
      .trim();

    try {
      await this.telegram.sendTyping(chatId);
      const history = await this.loadHistory(chatId);
      // The model sees who is talking — in a group the history is a mix of people
      const reply = await this.aiReply.generateReply(
        `${authorLabel(msg.from)}: ${cleanText || text}`,
        history,
      );
      await this.telegram.sendMessage(chatId, reply);
      await this.saveLog(msg, reply);
    } catch (error) {
      this.logger.error(error);
      await this.telegram
        .sendMessage(chatId, FALLBACK_MESSAGE)
        .catch(() => undefined);
      await this.saveLog(msg, ERROR_PREFIX + (error as Error).message).catch(
        (logError) => this.logger.error(logError),
      );
    }
  }

  // Context is a nice-to-have: a repository failure degrades to a contextless
  // reply rather than killing the whole turn
  private async loadHistory(chatId: number): Promise<IConversationTurn[]> {
    try {
      const logs = await this.messageRepository.findByChatId(
        chatId,
        HISTORY_LIMIT,
      );
      const since = this.config.historySince;
      return logs
        .slice()
        .reverse() // repository returns newest first
        .filter(
          (log) =>
            log.text &&
            log.botResponse &&
            !log.botResponse.startsWith(ERROR_PREFIX) &&
            // Anything the bot said under an older persona stays out
            (!since || (log.createdAt && log.createdAt >= since)),
        )
        .map((log) => ({
          userText: `${authorLabel({
            id: log.userId,
            username: log.username,
            firstName: log.firstName,
            lastName: log.lastName,
          })}: ${log.text}`,
          botResponse: log.botResponse,
        }));
    } catch (error) {
      this.logger.error(error);
      return [];
    }
  }

  private saveLog(
    msg: IncomingTelegramMessage,
    botResponse: string | null,
  ): Promise<unknown> {
    return this.messageRepository.save({
      userId: msg.from.id,
      username: msg.from.username,
      firstName: msg.from.firstName,
      lastName: msg.from.lastName,
      chatId: msg.chatId,
      chatType: msg.chatType,
      chatTitle: msg.chatTitle,
      text: msg.text,
      botResponse,
    });
  }
}
