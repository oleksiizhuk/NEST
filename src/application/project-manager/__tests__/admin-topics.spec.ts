import {
  AdminTopic,
  IAdminTopics,
} from '@application/project-manager/admin-topics.interface';
import {
  ADMIN_CHAT_DAILY_LIMIT,
  AdminTopicsUseCase,
  TopicError,
  TopicLimitError,
  topicHistory,
} from '@application/project-manager/use-cases/admin-topics.use-case';
import { PmToolbox } from '@application/project-manager/tools/pm-toolbox';

const now = new Date('2026-09-28T10:00:00Z');

const topic = (over: Partial<AdminTopic> = {}): AdminTopic => ({
  id: 't1',
  userId: 7,
  title: 'Новая тема',
  context: null,
  messages: [],
  createdAt: now,
  updatedAt: now,
  ...over,
});

const setup = (current = topic(), used = 0) => {
  const store: jest.Mocked<IAdminTopics> = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(current),
    create: jest.fn(),
    claim: jest.fn().mockResolvedValue(current),
    append: jest.fn().mockImplementation(async (_id, _u, messages) => ({
      ...current,
      messages: [...current.messages, ...messages],
    })),
    release: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn(),
    countQuestionsSince: jest.fn().mockResolvedValue(used),
  };
  const answer = {
    execute: jest
      .fn()
      .mockResolvedValue({ text: 'ответ', proposal: null, choices: [] }),
  };
  return {
    store,
    answer,
    useCase: new AdminTopicsUseCase(store, answer as any),
  };
};

describe('AdminTopicsUseCase', () => {
  it('asks with the page context, the topic history and no actions', async () => {
    const current = topic({
      title: 'Иван: Задача застряла',
      context: 'Сигнал: stale, KAN-1 33 дня',
      messages: [
        { role: 'user', text: 'Почему так?', at: now },
        { role: 'bot', text: 'Потому что...', at: now },
      ],
    });
    const { useCase, answer, store } = setup(current);
    await useCase.ask('t1', 7, '  Это плохо?  ', { canReadCode: false }, now);
    const [question, history, chat] = answer.execute.mock.calls[0];
    expect(question).toContain('<page_context>\nСигнал: stale, KAN-1 33 дня');
    expect(question).toContain('Topic: Иван: Задача застряла');
    expect(question.endsWith('Это плохо?')).toBe(true);
    expect(history).toEqual([
      { userText: 'Почему так?', botResponse: 'Потому что...' },
    ]);
    expect(chat).toMatchObject({
      requesterId: 7,
      canReadCode: false,
      noActions: true,
    });
    // Only the first question names a blank topic
    expect(store.append.mock.calls[0][4]).toBeUndefined();
    expect(store.append.mock.calls[0][2][0]).toMatchObject({
      role: 'user',
      text: 'Это плохо?',
    });
  });

  it('names a blank topic after its first question', async () => {
    const { useCase, store } = setup();
    await useCase.ask(
      't1',
      7,
      'Успеваем к релизу?',
      { canReadCode: true },
      now,
    );
    expect(store.append.mock.calls[0][4]).toBe('Успеваем к релизу?');
  });

  it('stops at the daily cap before calling the model', async () => {
    const { useCase, answer, store } = setup(topic(), ADMIN_CHAT_DAILY_LIMIT);
    await expect(
      useCase.ask('t1', 7, 'вопрос', { canReadCode: true }, now),
    ).rejects.toBeInstanceOf(TopicLimitError);
    expect(answer.execute).not.toHaveBeenCalled();
    expect(store.claim).not.toHaveBeenCalled();
  });

  it('refuses a second question while one is answered', async () => {
    const { useCase, store, answer } = setup();
    store.claim.mockResolvedValueOnce(null);
    await expect(
      useCase.ask('t1', 7, 'вопрос', { canReadCode: true }, now),
    ).rejects.toBeInstanceOf(TopicError);
    expect(answer.execute).not.toHaveBeenCalled();
  });

  it('frees the topic when the model fails', async () => {
    const { useCase, store, answer } = setup();
    answer.execute.mockRejectedValueOnce(new Error('down'));
    await expect(
      useCase.ask('t1', 7, 'вопрос', { canReadCode: true }, now),
    ).rejects.toThrow('down');
    expect(store.release).toHaveBeenCalledWith('t1', 7);
    expect(store.append).not.toHaveBeenCalled();
  });

  it('refuses another person’s or a missing topic', async () => {
    const { useCase, store } = setup();
    store.get.mockResolvedValueOnce(null);
    await expect(
      useCase.ask('t1', 8, 'вопрос', { canReadCode: true }, now),
    ).rejects.toBeInstanceOf(TopicError);
  });

  it('pairs questions with answers for the history', () => {
    const t = topic({
      messages: [
        { role: 'user', text: 'a', at: now },
        { role: 'bot', text: 'b', at: now },
        { role: 'user', text: 'c', at: now },
        { role: 'bot', text: 'd', at: now },
      ],
    });
    expect(topicHistory(t, 1)).toEqual([{ userText: 'c', botResponse: 'd' }]);
  });
});

describe('PmToolbox on the admin page', () => {
  it('refuses proposals when actions are off', async () => {
    const box = new PmToolbox(
      { repos: () => [] } as any,
      { tiers: () => [], roles: () => [] } as any,
      {} as any,
    );
    await expect(
      box.run(
        'propose_create_brand',
        {},
        {
          chatId: 0,
          requesterId: 7,
          proposal: null,
          noActions: true,
        },
      ),
    ).rejects.toThrow(/admin page/);
  });
});
