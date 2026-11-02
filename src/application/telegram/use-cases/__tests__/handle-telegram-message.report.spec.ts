import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { ReviewRefused } from '@application/project-manager/use-cases/team-review.use-case';

const OWNER = 1;
const PM_GROUP = -100;
const BOT = { id: 42, username: 'nest_bot' };

const dm = (fromId: number, text: string) => ({
  chatId: fromId,
  chatType: 'private',
  chatTitle: null,
  text,
  from: { id: fromId, username: 'someone', firstName: 'X', lastName: null },
});

const press = (fromId: number, person: string, chatType = 'private') => ({
  ...dm(fromId, `Отчёт: ${person}`),
  chatType,
  callback: {
    id: 'cb',
    messageId: 77,
    kind: 'person' as const,
    person,
  },
});

describe('HandleTelegramMessageUseCase — /report', () => {
  const telegram = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    getBotInfo: jest.fn().mockResolvedValue(BOT),
    answerCallback: jest.fn().mockResolvedValue(undefined),
    clearButtons: jest.fn().mockResolvedValue(undefined),
    sendWithButtons: jest.fn().mockResolvedValue(1),
    setButtons: jest.fn().mockResolvedValue(undefined),
    isMember: jest.fn().mockResolvedValue(false),
  };
  const repo = {
    save: jest.fn().mockResolvedValue(undefined),
    findByChatId: jest.fn().mockResolvedValue([]),
    setFeedback: jest.fn(),
    recentAnswers: jest.fn(),
  };
  const pmAnswer = { execute: jest.fn() };
  const teamReview = {
    peopleNames: jest.fn(),
    personReport: jest.fn(),
  };

  const build = (focusPerson?: string, dmUsernames: string[] = []) => {
    const pm = {
      chatIds: [PM_GROUP],
      digestChatId: null,
      releaseDate: null,
      projectBrief: '',
      maxSnapshotAgeHours: 30,
      actionUserIds: [],
      dmUsernames,
      team: [],
      ...(focusPerson ? { focusPerson } : {}),
    };
    return new HandleTelegramMessageUseCase(
      telegram,
      { generateReply: jest.fn() },
      repo as any,
      {
        ownerId: OWNER,
        mode: 'webhook',
        webhookSecret: 's',
        historySince: null,
      },
      pm,
      pmAnswer as any,
      { execute: jest.fn() } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      { current: jest.fn().mockResolvedValue(pm) } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      teamReview as any,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    teamReview.peopleNames.mockResolvedValue(['Ann Lee', 'Bob', 'Карина']);
    teamReview.personReport.mockResolvedValue({
      text: 'Сейчас: A-1…',
      at: new Date('2026-11-02T09:30:00Z'),
      cached: false,
    });
  });

  it('offers the owner every person as a button, two per row', async () => {
    await build().execute(dm(OWNER, '/report'));
    const [chat, text, buttons] = telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(OWNER);
    expect(text).toContain('По кому отчёт?');
    expect(buttons).toEqual([
      [
        { text: 'Ann Lee', data: 'rp:0' },
        { text: 'Bob', data: 'rp:1' },
      ],
      [{ text: 'Карина', data: 'rp:2' }],
    ]);
    expect(pmAnswer.execute).not.toHaveBeenCalled();
  });

  it('works in personal mode too, where only the owner is answered', async () => {
    await build('Max Brenner').execute(dm(OWNER, '/report'));
    expect(telegram.sendMessage.mock.calls[0][2]).toHaveLength(2);
  });

  it('says what to do when the snapshot has nobody', async () => {
    teamReview.peopleNames.mockResolvedValue([]);
    await build().execute(dm(OWNER, '/report'));
    expect(telegram.sendMessage.mock.calls[0][1]).toContain('/refresh');
    expect(telegram.sendMessage.mock.calls[0][2]).toBeUndefined();
  });

  it('keeps reports out of groups and away from anyone but the owner', async () => {
    await build().execute({
      ...dm(OWNER, '/report'),
      chatId: PM_GROUP,
      chatType: 'supergroup',
      chatTitle: 'Team',
    });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain('только в личку');
    expect(teamReview.peopleNames).not.toHaveBeenCalled();

    telegram.sendMessage.mockClear();
    await build().execute({
      ...dm(7, '/report'),
      chatId: PM_GROUP,
      chatType: 'supergroup',
      chatTitle: 'Team',
    });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(teamReview.peopleNames).not.toHaveBeenCalled();
  });

  it("sends the picked person's report and keeps it in the PM history", async () => {
    await build().execute(press(OWNER, 'Bob'));
    expect(telegram.answerCallback).toHaveBeenCalledWith(
      'cb',
      'Готовлю отчёт: Bob',
    );
    expect(teamReview.personReport).toHaveBeenCalledWith(
      'Bob',
      expect.any(Date),
    );
    const [chat, text] = telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(OWNER);
    expect(text).toBe('📋 Bob\n\nСейчас: A-1…');
    // The picker stays for the next person
    expect(telegram.clearButtons).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: OWNER,
        text: 'Отчёт: Bob',
        botResponse: text,
        mode: 'pm',
      }),
    );
  });

  it('says when the report is the one already written on the same data', async () => {
    teamReview.personReport.mockResolvedValue({
      text: 'Сейчас: A-1…',
      at: new Date('2026-11-02T09:30:00Z'),
      cached: true,
    });
    await build().execute(press(OWNER, 'Bob'));
    expect(telegram.sendMessage.mock.calls[0][1]).toContain(
      'тот же отчёт, что в 09:30 UTC',
    );
  });

  it('ignores a press by anyone else or outside the private chat', async () => {
    await build().execute(press(7, 'Bob'));
    await build().execute({
      ...press(OWNER, 'Bob', 'supergroup'),
      chatId: PM_GROUP,
    });
    expect(teamReview.personReport).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('pays once when the same name is pressed again while it is written', async () => {
    let finish: (v: unknown) => void = () => undefined;
    teamReview.personReport.mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    const bot = build();
    const first = bot.execute(press(OWNER, 'Bob'));
    await new Promise((r) => setImmediate(r));
    await bot.execute(press(OWNER, 'Bob'));
    expect(telegram.answerCallback).toHaveBeenLastCalledWith(
      'cb',
      'Уже готовлю этот отчёт',
    );
    finish({ text: 'r', at: new Date(), cached: false });
    await first;
    expect(teamReview.personReport).toHaveBeenCalledTimes(1);
    // Done: the next press writes again
    await bot.execute(press(OWNER, 'Bob'));
    expect(teamReview.personReport).toHaveBeenCalledTimes(2);
  });

  it('shows a refusal as is, the spend limit with its date, and hides faults', async () => {
    const bot = build();
    teamReview.personReport.mockRejectedValueOnce(
      new ReviewRefused('На сегодня уже подготовлено 20 разборов'),
    );
    await bot.execute(press(OWNER, 'Bob'));
    expect(telegram.sendMessage.mock.calls[0][1]).toBe(
      'На сегодня уже подготовлено 20 разборов',
    );
    teamReview.personReport.mockRejectedValueOnce(
      new Error(
        '400 You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.',
      ),
    );
    await bot.execute(press(OWNER, 'Bob'));
    expect(telegram.sendMessage.mock.calls[1][1]).toContain(
      'до 2026-12-01 00:00 UTC',
    );
    teamReview.personReport.mockRejectedValueOnce(
      new Error('Mongo connection reset'),
    );
    await bot.execute(press(OWNER, 'Bob'));
    expect(telegram.sendMessage.mock.calls[2][1]).toBe(
      'Что-то пошло не так 😢',
    );
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('gives a team member who may DM the bot neither the list nor a report', async () => {
    // 'someone' may talk to the bot in private (PM mode), but is not the owner
    const bot = build(undefined, ['someone']);
    await bot.execute(dm(7, '/report'));
    await bot.execute(press(7, 'Bob'));
    expect(teamReview.peopleNames).not.toHaveBeenCalled();
    expect(teamReview.personReport).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(telegram.answerCallback).toHaveBeenCalledWith('cb');
  });

  it('in personal mode reports to the owner in private and stays silent in groups', async () => {
    const bot = build('Max Brenner');
    await bot.execute(press(OWNER, 'Bob'));
    expect(teamReview.personReport).toHaveBeenCalledWith(
      'Bob',
      expect.any(Date),
    );
    expect(telegram.sendMessage.mock.calls[0][0]).toBe(OWNER);
    telegram.sendMessage.mockClear();
    await bot.execute({
      ...dm(OWNER, '/report'),
      chatId: PM_GROUP,
      chatType: 'supergroup',
      chatTitle: 'Team',
    });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('asks for a fresh list when the pressed picker is too old to read', async () => {
    const stale = press(OWNER, 'x');
    delete (stale.callback as { person?: string }).person;
    await build().execute(stale);
    expect(telegram.answerCallback).toHaveBeenCalledWith(
      'cb',
      'Список устарел: отправьте /report ещё раз',
    );
    expect(teamReview.personReport).not.toHaveBeenCalled();
  });
});
