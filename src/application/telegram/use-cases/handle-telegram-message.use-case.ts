import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import {
  IAiReplyService,
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

const FALLBACK_MESSAGE = 'Что-то пошло не так 😢';

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
    if (isGroup && chatId !== this.config.allowedChatId) return;

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
      const reply = await this.aiReply.generateReply(cleanText || text);
      await this.telegram.sendMessage(chatId, reply);
      await this.saveLog(msg, reply);
    } catch (error) {
      this.logger.error(error);
      await this.telegram
        .sendMessage(chatId, FALLBACK_MESSAGE)
        .catch(() => undefined);
      await this.saveLog(msg, 'ERROR: ' + (error as Error).message).catch(
        (logError) => this.logger.error(logError),
      );
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
