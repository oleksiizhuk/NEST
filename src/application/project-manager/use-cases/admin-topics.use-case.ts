import { Inject, Injectable } from '@nestjs/common';
import {
  AdminTopic,
  IAdminTopics,
  PM_ADMIN_TOPICS,
  TopicSummary,
} from '@application/project-manager/admin-topics.interface';
import { PmTurn } from '@application/project-manager/project-manager-ai.interface';
import { AnswerProjectQuestionUseCase } from '@application/project-manager/use-cases/answer-project-question.use-case';

// Questions to the model from the admin page per UTC day, everyone together
export const ADMIN_CHAT_DAILY_LIMIT = 60;
// Answers kept in one topic; after that a new topic starts fresh
export const TOPIC_MAX_MESSAGES = 100;
// Earlier turns sent with each question
const HISTORY_TURNS = 10;
export const TOPIC_CONTEXT_MAX = 8_000;
export const TOPIC_TEXT_MAX = 4_000;
export const BLANK_TITLE = 'Новая тема';
// Longer than the answer budget, so a crashed answer frees the topic later
const CLAIM_MS = 5 * 60_000;

// Kept out of the cached prompt prefix (it rides with the question)
const ADMIN_NOTE = [
  'This conversation is on the admin page, not in Telegram. Nothing can be proposed for execution here: the propose_* tools refuse; if the person asks to do something on dev/staging or to remember something, say it is done in the Telegram chat with the bot.',
  'Reply in plain text without Markdown or HTML.',
  'The person often asks why the page showed a signal or a number and whether it is good or bad: explain where it comes from (the rule and threshold when the topic has them), check it against the snapshot before agreeing, say what it means for the team and the release, and what is sensible to do. Do not rank or judge people.',
].join('\n');

export class TopicError extends Error {}
export class TopicLimitError extends TopicError {}

const dayStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// Pairs each question with the answer after it; the newest turns last
export const topicHistory = (topic: AdminTopic, turns: number): PmTurn[] => {
  const out: PmTurn[] = [];
  const m = topic.messages;
  for (let i = 0; i + 1 < m.length; i++) {
    if (m[i].role === 'user' && m[i + 1].role === 'bot') {
      out.push({ userText: m[i].text, botResponse: m[i + 1].text });
      i++;
    }
  }
  return out.slice(-turns);
};

@Injectable()
export class AdminTopicsUseCase {
  constructor(
    @Inject(PM_ADMIN_TOPICS) private readonly topics: IAdminTopics,
    private readonly answer: AnswerProjectQuestionUseCase,
  ) {}

  async list(
    userId: number,
    now = new Date(),
  ): Promise<{ topics: TopicSummary[]; used: number; limit: number }> {
    const [topics, used] = await Promise.all([
      this.topics.list(userId),
      this.topics.countQuestionsSince(dayStart(now)),
    ]);
    return { topics, used, limit: ADMIN_CHAT_DAILY_LIMIT };
  }

  get(id: string, userId: number): Promise<AdminTopic | null> {
    return this.topics.get(id, userId);
  }

  create(
    userId: number,
    title: string,
    context: string | null,
    now = new Date(),
  ): Promise<AdminTopic> {
    const name = title.trim().slice(0, 120) || BLANK_TITLE;
    const seed = context?.trim().slice(0, TOPIC_CONTEXT_MAX) || null;
    return this.topics.create({ userId, title: name, context: seed }, now);
  }

  remove(id: string, userId: number): Promise<void> {
    return this.topics.remove(id, userId);
  }

  async ask(
    id: string,
    userId: number,
    text: string,
    who: { canReadCode: boolean },
    now = new Date(),
  ): Promise<AdminTopic> {
    const question = text.trim().slice(0, TOPIC_TEXT_MAX);
    if (!question) throw new TopicError('Пустой вопрос.');
    const topic = await this.topics.get(id, userId);
    if (!topic) throw new TopicError('Тема не найдена.');
    if (topic.messages.length >= TOPIC_MAX_MESSAGES)
      throw new TopicError(
        'В этой теме уже много сообщений — начните новую, так ответы будут точнее.',
      );
    if (
      (await this.topics.countQuestionsSince(dayStart(now))) >=
      ADMIN_CHAT_DAILY_LIMIT
    )
      throw new TopicLimitError(
        `Сегодня уже задано ${ADMIN_CHAT_DAILY_LIMIT} вопросов из админки — это дневной предел. Завтра можно снова, а в Telegram бот отвечает как обычно.`,
      );
    const claimed = await this.topics.claim(
      id,
      userId,
      new Date(now.getTime() + CLAIM_MS),
    );
    if (!claimed)
      throw new TopicError('Бот ещё отвечает в этой теме — подождите ответа.');
    try {
      const seed = claimed.context
        ? `\n\nThe topic was opened from the admin page, which showed:\n<page_context>\n${claimed.context}\n</page_context>`
        : '';
      const result = await this.answer.execute(
        `${ADMIN_NOTE}${seed}\n\nTopic: ${claimed.title}\n\n${question}`,
        topicHistory(claimed, HISTORY_TURNS),
        {
          chatId: 0,
          requesterId: userId,
          canReadCode: who.canReadCode,
          noActions: true,
        },
        now,
      );
      const saved = await this.topics.append(
        id,
        userId,
        [
          { role: 'user', text: question, at: now },
          {
            role: 'bot',
            text: result.text,
            at: new Date(),
            ...(result.choices.length ? { choices: result.choices } : {}),
          },
        ],
        new Date(),
        // A blank topic is named after its first question
        claimed.title === BLANK_TITLE && claimed.messages.length === 0
          ? question.replace(/\s+/g, ' ').slice(0, 80)
          : undefined,
      );
      if (!saved) throw new TopicError('Тема удалена, пока бот отвечал.');
      return saved;
    } catch (error) {
      await this.topics.release(id, userId).catch(() => undefined);
      throw error;
    }
  }
}
