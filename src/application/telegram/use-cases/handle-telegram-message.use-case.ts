import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import {
  IAiReplyService,
  IConversationTurn,
  AI_REPLY_SERVICE,
  AI_UNAVAILABLE_REPLY,
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
import { PmTurn } from '@application/project-manager/project-manager-ai.interface';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import { AnswerProjectQuestionUseCase } from '@application/project-manager/use-cases/answer-project-question.use-case';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';

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
const PM_MODE = 'pm';
const STATUS_QUESTION =
  'How are we doing? Give the release verdict, what each person should focus on today, and the top risks.';
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
    // Project-manager mode is optional: without it every chat gets the persona
    @Optional()
    @Inject(PM_CONFIG)
    private readonly pmConfig?: IPmConfig,
    @Optional() private readonly pmAnswer?: AnswerProjectQuestionUseCase,
    @Optional() private readonly pmRefresh?: RefreshProjectSnapshotUseCase,
  ) {}

  // Project data only ever reaches chats the owner listed; any other group
  // gets the persona, which has no access to it.
  private isPmChat(chatId: number): boolean {
    return Boolean(this.pmAnswer && this.pmConfig?.chatIds.includes(chatId));
  }

  async execute(msg: IncomingTelegramMessage): Promise<void> {
    const { chatId, chatType, text } = msg;
    if (!text) return;

    const isPrivate = chatType === 'private';
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    if (!isPrivate && !isGroup) return;

    // Groups are open — the mention/reply check below is the only gate there
    if (isPrivate && msg.from.id !== this.config.ownerId) return;

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

    if (this.isPmChat(chatId)) {
      await this.handleAsProjectManager(msg, cleanText || text);
      return;
    }

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

  private async handleAsProjectManager(
    msg: IncomingTelegramMessage,
    text: string,
  ): Promise<void> {
    const { chatId } = msg;
    const { pmAnswer, pmRefresh } = this;
    if (!pmAnswer || !pmRefresh) return;
    const command = text.trim().split(/\s+/)[0].toLowerCase().split('@')[0];
    // Opus can think for a minute or two; keep the "typing…" indicator alive
    const typing = setInterval(
      () => void this.telegram.sendTyping(chatId).catch(() => undefined),
      5000,
    );
    try {
      await this.telegram.sendTyping(chatId);
      let reply: string;
      if (command === '/refresh') {
        if (msg.from.id !== this.config.ownerId) return;
        const snapshot = await pmRefresh.execute();
        reply =
          'Данные обновлены: ' +
          snapshot.sections
            .map((s) => `${s.source} ${s.ok ? 'ok' : `ошибка (${s.error})`}`)
            .join(', ');
      } else {
        const question =
          command === '/status' || command === '/start'
            ? STATUS_QUESTION
            : text;
        const history = await this.loadPmHistory(chatId);
        reply = await pmAnswer.execute(
          `${authorLabel(msg.from)}: ${question}`,
          history,
        );
      }
      await this.telegram.sendMessage(chatId, reply);
      await this.saveLog(msg, reply, PM_MODE);
    } catch (error) {
      this.logger.error(error);
      await this.telegram
        .sendMessage(chatId, FALLBACK_MESSAGE)
        .catch(() => undefined);
      await this.saveLog(
        msg,
        ERROR_PREFIX + (error as Error).message,
        PM_MODE,
      ).catch((logError) => this.logger.error(logError));
    } finally {
      clearInterval(typing);
    }
  }

  private async loadPmHistory(chatId: number): Promise<PmTurn[]> {
    try {
      const logs = await this.messageRepository.findByChatId(
        chatId,
        HISTORY_LIMIT * 2,
      );
      return logs
        .slice()
        .reverse()
        .filter(
          (log) =>
            log.mode === PM_MODE &&
            log.text &&
            log.botResponse &&
            !log.botResponse.startsWith(ERROR_PREFIX),
        )
        .slice(-6)
        .map((log) => ({
          userText: `${authorLabel({
            id: log.userId,
            username: log.username,
            firstName: log.firstName,
            lastName: log.lastName,
          })}: ${log.text}`,
          botResponse: log.botResponse as string,
        }));
    } catch (error) {
      this.logger.error(error);
      return [];
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
            log.mode !== PM_MODE &&
            log.text &&
            log.botResponse &&
            !log.botResponse.startsWith(ERROR_PREFIX) &&
            // A degraded reply is not something the bot "said" — replaying it
            // teaches the model to produce more of them
            log.botResponse !== AI_UNAVAILABLE_REPLY &&
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
    mode?: string,
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
      ...(mode ? { mode } : {}),
    });
  }
}
