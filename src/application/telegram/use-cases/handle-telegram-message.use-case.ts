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
import {
  IReplyImageRenderer,
  REPLY_IMAGE_RENDERER,
} from '@application/telegram/reply-image.renderer.interface';
import { IncomingTelegramMessage } from '@application/telegram/incoming-telegram-message';

const FALLBACK_MESSAGE = 'Что-то пошло не так 😢';
const ERROR_PREFIX = 'ERROR: ';
// Exchanges (user + bot) replayed to the model as conversation context
const HISTORY_LIMIT = 10;
// Telegram truncates photo captions past this
const CAPTION_LIMIT = 1024;
const URL_PATTERN = /https?:\/\/\S+/g;

@Injectable()
export class HandleTelegramMessageUseCase {
  private readonly logger = new Logger(HandleTelegramMessageUseCase.name);

  constructor(
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(AI_REPLY_SERVICE) private readonly aiReply: IAiReplyService,
    @Inject(TELEGRAM_MESSAGE_REPOSITORY)
    private readonly messageRepository: ITelegramMessageRepository,
    @Inject(REPLY_IMAGE_RENDERER)
    private readonly imageRenderer: IReplyImageRenderer,
    @Inject(TELEGRAM_CONFIG) private readonly config: ITelegramConfig,
  ) {}

  async execute(msg: IncomingTelegramMessage): Promise<void> {
    const { chatId, chatType, text } = msg;
    if (!text) return;

    const isPrivate = chatType === 'private';
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    if (!isPrivate && !isGroup) return;

    if (isPrivate && msg.from.id !== this.config.ownerId) return;
    if (isGroup && !this.config.allowedChatIds.includes(chatId)) return;

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
      const reply = await this.aiReply.generateReply(
        cleanText || text,
        history,
      );
      await this.deliver(chatId, reply);
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

  // The reply goes out as a themed picture when the renderer produced one.
  // Links are repeated in the caption — text baked into a PNG is not clickable.
  private async deliver(chatId: number, reply: string): Promise<void> {
    const image = await this.imageRenderer.render(reply);
    if (!image) {
      await this.telegram.sendMessage(chatId, reply);
      return;
    }

    const caption = (reply.match(URL_PATTERN) ?? [])
      .join('\n')
      .slice(0, CAPTION_LIMIT);
    try {
      await this.telegram.sendPhoto(chatId, image, caption || undefined);
    } catch (error) {
      // Upload can fail on its own (size, network) — the text still must land
      this.logger.error(error);
      await this.telegram.sendMessage(chatId, reply);
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
      return logs
        .slice()
        .reverse() // repository returns newest first
        .filter(
          (log) =>
            log.text &&
            log.botResponse &&
            !log.botResponse.startsWith(ERROR_PREFIX),
        )
        .map((log) => ({ userText: log.text, botResponse: log.botResponse }));
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
