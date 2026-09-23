import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  InlineButton,
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
import { ConfirmPendingActionUseCase } from '@application/project-manager/use-cases/confirm-pending-action.use-case';
import { PendingAction } from '@application/project-manager/pending-action.interface';
import {
  IPmChatRegistry,
  PM_CHAT_REGISTRY,
} from '@application/project-manager/pm-chat-registry.interface';
import {
  IPmMemory,
  PM_MEMORY,
} from '@application/project-manager/memory.interface';

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
// Commands the bot answers in a group even without an @mention
const BOT_COMMANDS = [
  '/pm_on',
  '/pm_off',
  '/status',
  '/refresh',
  '/confirm',
  '/cancel',
  '/memory',
  '/forget',
];
const CONFIRM_WORDS = /^(да|ага|yes|ok|ок|подтверждаю|confirm)[.!]*$/i;

const proposalFooter = (action: PendingAction): string =>
  `\n\n${action.summary}\nПодтвердить: кнопка ниже, «да» или /confirm ${action.id}. Отменить: /cancel ${action.id}. Действует 10 минут.`;

const proposalButtons = (action: PendingAction): InlineButton[][] => [
  [
    { text: '✅ Подтвердить', data: `c:${action.id}` },
    { text: '❌ Отменить', data: `x:${action.id}` },
  ],
];

// Ties a 👍/👎 press to the logged answer without exposing its id
const newFeedbackToken = (): string => randomBytes(6).toString('hex');

const feedbackButtons = (token: string): InlineButton[][] => [
  [
    { text: '👍', data: `f:+:${token}` },
    { text: '👎', data: `f:-:${token}` },
  ],
];

// One option per row: labels are short sentences, not single words
const choiceButtons = (choices: string[]): InlineButton[][] =>
  choices.map((text, i) => [{ text, data: `o:${i}` }]);

// "/status@my_bot args" → "/status" when addressed to this bot or to nobody
const commandOf = (text: string, botUsername: string): string | null => {
  const [first] = text.trim().split(/\s+/);
  if (!first.startsWith('/')) return null;
  const [name, target] = first.toLowerCase().split('@');
  if (target && target !== botUsername.toLowerCase()) return null;
  return name;
};
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
    @Optional()
    @Inject(PM_CHAT_REGISTRY)
    private readonly pmChats?: IPmChatRegistry,
    @Optional() private readonly pmConfirm?: ConfirmPendingActionUseCase,
    @Optional()
    @Inject(PM_MEMORY)
    private readonly pmMemory?: IPmMemory,
  ) {}

  private canRunActions(userId: number): boolean {
    return (
      userId === this.config.ownerId ||
      Boolean(this.pmConfig?.actionUserIds.includes(userId))
    );
  }

  // Project data only ever reaches chats the owner listed; any other group
  // gets the persona, which has no access to it.
  private isTeamDm(msg: IncomingTelegramMessage): boolean {
    const username = msg.from.username?.toLowerCase();
    return Boolean(
      this.pmAnswer &&
        msg.chatType === 'private' &&
        username &&
        this.pmConfig?.dmUsernames.includes(username),
    );
  }

  private async isPmChat(
    chatId: number,
    msg?: IncomingTelegramMessage,
  ): Promise<boolean> {
    if (!this.pmAnswer) return false;
    if (msg && this.isTeamDm(msg)) return true;
    if (this.pmConfig?.chatIds.includes(chatId)) return true;
    return this.pmChats
      ? this.pmChats.isEnabled(chatId).catch(() => false)
      : false;
  }

  async execute(msg: IncomingTelegramMessage): Promise<void> {
    const { chatId, chatType, text } = msg;
    if (!text) return;

    const isPrivate = chatType === 'private';
    const isGroup = chatType === 'group' || chatType === 'supergroup';
    if (!isPrivate && !isGroup) return;

    // Groups are open — the mention/reply check below is the only gate there.
    // In private, only the owner and the team members listed for PM DMs.
    if (
      isPrivate &&
      msg.from.id !== this.config.ownerId &&
      !this.isTeamDm(msg)
    ) {
      return;
    }

    // A button press is addressed to the bot by definition; no mention needed
    if (msg.callback) {
      await this.handleButton(msg, text);
      return;
    }

    const botInfo = await this.telegram.getBotInfo();

    const command = commandOf(text, botInfo.username);

    if (isGroup) {
      const isMentioned = text
        .toLowerCase()
        .includes(`@${botInfo.username.toLowerCase()}`);
      const isReply = msg.replyToBotId === botInfo.id;
      // Commands skip the @mention only where they mean something: /pm_on and
      // /pm_off anywhere (owner-only), the PM commands in PM chats. Elsewhere
      // a bare "/status" is not addressed to this bot and costs nothing.
      const isOurCommand =
        command !== null &&
        (command === '/pm_on' ||
          command === '/pm_off' ||
          (BOT_COMMANDS.includes(command) &&
            (await this.isPmChat(chatId, msg))));
      if (!isMentioned && !isReply && !isOurCommand) return;
    }

    if (command === '/pm_on' || command === '/pm_off') {
      await this.togglePmMode(msg, command === '/pm_on', isGroup);
      return;
    }

    const cleanText = text
      .replace(new RegExp(`@${botInfo.username}`, 'gi'), '')
      .trim();

    if (await this.isPmChat(chatId, msg)) {
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

  // Options may be picked by anyone who can talk to the bot here; confirm
  // and cancel only by someone allowed to run actions. An unauthorised
  // press gets a toast and leaves the buttons for someone who may press them.
  private async handleButton(
    msg: IncomingTelegramMessage,
    text: string,
  ): Promise<void> {
    const callback = msg.callback;
    if (!callback) return;
    if (!(await this.isPmChat(msg.chatId, msg))) {
      await this.telegram.answerCallback(callback.id).catch(() => undefined);
      return;
    }
    if (callback.kind === 'feedback') {
      await this.recordFeedback(msg);
      return;
    }
    const allowed =
      callback.kind === 'option' || this.canRunActions(msg.from.id);
    await this.telegram
      .answerCallback(
        callback.id,
        allowed
          ? callback.kind === 'option'
            ? 'Принято'
            : undefined
          : 'Нет прав на это действие',
      )
      .catch(() => undefined);
    if (!allowed) return;
    await this.telegram
      .clearButtons(msg.chatId, callback.messageId)
      .catch(() => undefined);
    await this.handleAsProjectManager(msg, text);
  }

  // Anyone who can talk to the bot here may rate an answer; the buttons go
  // away after the first vote
  private async recordFeedback(msg: IncomingTelegramMessage): Promise<void> {
    const { callback } = msg;
    if (!callback?.token || !callback.vote) return;
    const saved = await this.messageRepository
      .setFeedback(callback.token, msg.chatId, callback.vote, msg.from.id)
      .catch((error) => {
        this.logger.error(error);
        return false;
      });
    await this.telegram
      .answerCallback(
        callback.id,
        saved
          ? callback.vote > 0
            ? 'Спасибо!'
            : 'Спасибо, учту. Напишите, что было не так, — это поможет.'
          : 'Этот ответ уже оценён',
      )
      .catch(() => undefined);
    await this.telegram
      .clearButtons(msg.chatId, callback.messageId)
      .catch(() => undefined);
  }

  // Only the owner can open project data to a chat. Anyone else asking gets
  // no reply, so the command does not advertise itself.
  private async togglePmMode(
    msg: IncomingTelegramMessage,
    on: boolean,
    isGroup: boolean,
  ): Promise<void> {
    if (
      msg.from.id !== this.config.ownerId ||
      !this.pmChats ||
      !this.pmAnswer
    ) {
      return;
    }
    if (!isGroup) {
      await this.telegram.sendMessage(
        msg.chatId,
        'Эта команда для группы: напишите /pm_on в чате команды.',
      );
      return;
    }
    if (on) {
      await this.pmChats.enable(msg.chatId, msg.chatTitle);
      await this.telegram.sendMessage(
        msg.chatId,
        'Режим менеджера проекта включён в этом чате. Спросите /status или упомяните меня с вопросом; по будням утром пришлю сводку.',
      );
    } else {
      await this.pmChats.disable(msg.chatId);
      await this.telegram.sendMessage(
        msg.chatId,
        'Режим менеджера проекта выключен в этом чате.',
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
    const first = text.trim().split(/\s+/)[0].toLowerCase();
    // Only "/word" is a command; "да" or a question is not
    const command = first.startsWith('/') ? first.split('@')[0] : null;
    // Opus can think for a minute or two; keep the "typing…" indicator alive
    const typing = setInterval(
      () => void this.telegram.sendTyping(chatId).catch(() => undefined),
      5000,
    );
    try {
      await this.telegram.sendTyping(chatId);
      let reply: string;
      let buttons: InlineButton[][] | undefined;
      let logged: string | undefined;
      let usage: Record<string, unknown> | undefined;
      let feedbackToken: string | undefined;
      const [, arg] = text.trim().split(/\s+/);
      const authorised = this.canRunActions(msg.from.id);
      if (command === '/refresh') {
        if (msg.from.id !== this.config.ownerId) return;
        const snapshot = await pmRefresh.execute();
        reply =
          'Данные обновлены: ' +
          snapshot.sections
            .map((s) => `${s.source} ${s.ok ? 'ok' : `ошибка (${s.error})`}`)
            .join(', ');
      } else if (
        this.pmConfirm &&
        (command === '/confirm' ||
          (!command &&
            // Only someone who may confirm turns "да" into a confirmation;
            // for anyone else it is an ordinary answer to the bot
            authorised &&
            CONFIRM_WORDS.test(text.trim()) &&
            // Nothing waiting: "да" is an answer for the model, not a confirmation
            (await this.pmConfirm.hasPending(chatId))))
      ) {
        reply = await this.pmConfirm.confirm(
          command === '/confirm' && arg ? arg : null,
          chatId,
          msg.from.id,
          authorised,
        );
      } else if (this.pmMemory && command === '/memory') {
        reply = await this.listMemory();
      } else if (this.pmMemory && command === '/forget') {
        reply = !authorised
          ? 'Нет прав удалять из памяти.'
          : !arg
          ? 'Укажите id: /forget M7K2Q (список: /memory)'
          : (await this.pmMemory.remove(arg))
          ? `Забыл ${arg.toUpperCase()}.`
          : `Записи ${arg.toUpperCase()} нет.`;
      } else if (this.pmConfirm && command === '/cancel') {
        reply = arg
          ? await this.pmConfirm.cancel(arg, chatId, authorised)
          : 'Укажите id: /cancel ABCDE';
      } else {
        const question =
          command === '/status' || command === '/start'
            ? STATUS_QUESTION
            : text;
        const history = await this.loadPmHistory(chatId);
        const answer = await pmAnswer.execute(
          `${authorLabel(msg.from)}: ${question}`,
          history,
          {
            chatId,
            requesterId: msg.from.id,
            requesterName: authorLabel(msg.from),
          },
        );
        if (answer.usage) usage = { ...answer.usage };
        if (answer.proposal) {
          reply = answer.text + proposalFooter(answer.proposal);
          buttons = proposalButtons(answer.proposal);
        } else {
          reply = answer.text;
          if (answer.choices?.length) {
            buttons = choiceButtons(answer.choices);
            // The model reads its own past replies; it must see what it offered
            logged = `${reply}\n[Кнопки: ${answer.choices.join(' | ')}]`;
          } else {
            feedbackToken = newFeedbackToken();
            buttons = feedbackButtons(feedbackToken);
          }
        }
      }
      // Buttons only when there are any: plain replies keep the two-argument call
      await (buttons
        ? this.telegram.sendMessage(chatId, reply, buttons)
        : this.telegram.sendMessage(chatId, reply));
      await this.saveLog(msg, logged ?? reply, PM_MODE, {
        ...(usage ? { usage } : {}),
        ...(feedbackToken ? { feedbackToken } : {}),
      });
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

  private async listMemory(): Promise<string> {
    const records = (await this.pmMemory?.active(new Date())) ?? [];
    if (!records.length) {
      return 'Память пуста. Скажите, например: «запомни, что мы убираем фильтры из релиза».';
    }
    return [
      `Помню ${records.length}:`,
      ...records.map(
        (r) =>
          `${r.id} · ${r.kind}${
            r.dueAt ? `, срок ${r.dueAt.toISOString().slice(0, 10)}` : ''
          } · ${r.text}`,
      ),
      'Удалить: /forget ID',
    ].join('\n');
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
    extra: { usage?: Record<string, unknown>; feedbackToken?: string } = {},
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
      ...extra,
    });
  }
}
