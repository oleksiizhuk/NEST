import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { TelegramMessage } from '@domain/telegram/telegram-message.entity';
import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';

const OWNER = 1;
const PM_GROUP = -100;
const OTHER_GROUP = -200;
const BOT = { id: 42, username: 'nest_bot' };

const group = (chatId: number, text: string, fromId = 7) => ({
  chatId,
  chatType: 'supergroup',
  chatTitle: 'Team',
  text,
  from: { id: fromId, username: 'dev', firstName: 'Dev', lastName: null },
});

describe('HandleTelegramMessageUseCase — project-manager mode', () => {
  const telegram = {
    sendMessage: jest.fn(),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    getBotInfo: jest.fn().mockResolvedValue(BOT),
    answerCallback: jest.fn().mockResolvedValue(undefined),
    clearButtons: jest.fn().mockResolvedValue(undefined),
    isMember: jest.fn().mockResolvedValue(false),
  };
  const persona = {
    generateReply: jest.fn().mockResolvedValue('persona reply'),
  };
  const repo = {
    save: jest.fn(),
    findByChatId: jest.fn(),
    setFeedback: jest.fn().mockResolvedValue(true),
    recentAnswers: jest.fn(),
  };
  const pmAnswer = {
    execute: jest
      .fn()
      .mockResolvedValue({ text: 'AT RISK: …', proposal: null }),
  };
  const pmRefresh = {
    execute: jest.fn().mockResolvedValue(
      new ProjectSnapshot('s', new Date(), [
        {
          source: 'issues',
          ok: true,
          fetchedAt: new Date(),
          text: 'x',
          error: null,
        },
      ]),
    ),
  };
  const registry = {
    isEnabled: jest.fn().mockResolvedValue(false),
    enable: jest.fn(),
    disable: jest.fn(),
    isDisabled: jest.fn().mockResolvedValue(false),
    clear: jest.fn(),
    digestChats: jest.fn(),
  };
  const confirm = {
    confirm: jest.fn().mockResolvedValue('Готово'),
    cancel: jest.fn().mockResolvedValue('Отменено'),
    hasPending: jest.fn().mockResolvedValue(true),
  };
  let useCase: HandleTelegramMessageUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findByChatId.mockResolvedValue([]);
    useCase = new HandleTelegramMessageUseCase(
      telegram,
      persona,
      repo as any,
      {
        ownerId: OWNER,
        mode: 'webhook',
        webhookSecret: 's',
        historySince: null,
      },
      {
        chatIds: [PM_GROUP, OWNER],
        digestChatId: null,
        releaseDate: '2026-09-30',
        projectBrief: '',
        maxSnapshotAgeHours: 30,
        actionUserIds: [],
        dmUsernames: ['dmytro_aa'],
        team: [],
      },
      pmAnswer as any,
      pmRefresh as any,
      registry,
      confirm as any,
    );
  });

  it('answers as project manager in a listed group and logs the turn as pm', async () => {
    await useCase.execute(group(PM_GROUP, '@nest_bot как дела?'));
    expect(pmAnswer.execute).toHaveBeenCalledWith('Dev @dev: как дела?', [], {
      chatId: PM_GROUP,
      requesterId: 7,
      requesterName: 'Dev @dev',
      canReadCode: false,
    });
    expect(persona.generateReply).not.toHaveBeenCalled();
    const [chat, text, buttons] = telegram.sendMessage.mock.calls[0];
    expect([chat, text]).toEqual([PM_GROUP, 'AT RISK: …']);
    const token = buttons[0][0].data.slice(4);
    expect(buttons).toEqual([
      [
        { text: '👍', data: `f:+:${token}` },
        { text: '👎', data: `f:-:${token}` },
      ],
    ]);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'pm', feedbackToken: token }),
    );
  });

  it('never gives project data to a group the owner is not in', async () => {
    await useCase.execute(group(OTHER_GROUP, '@nest_bot как дела по релизу?'));
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(pmRefresh.execute).not.toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
    expect(telegram.sendMessage.mock.calls[0][1]).toContain(
      'только в чатах команды',
    );
  });

  it('is the manager in every group the owner is in, unless switched off', async () => {
    telegram.isMember.mockImplementation(
      async (chatId: number, userId: number) =>
        chatId === -777 && userId === OWNER,
    );
    await useCase.execute(group(-777, '@nest_bot как дела?'));
    expect(pmAnswer.execute).toHaveBeenCalledTimes(1);
    expect(telegram.isMember).toHaveBeenCalledWith(-777, OWNER);

    registry.isDisabled.mockResolvedValueOnce(true);
    await useCase.execute(group(-778, '@nest_bot как дела?'));
    expect(pmAnswer.execute).toHaveBeenCalledTimes(1);

    (useCase as any).live = undefined;
    (useCase as any).pmRuntime = {
      current: jest.fn().mockResolvedValue({
        ...(useCase as any).pmConfig,
        pmInOwnerGroups: false,
      }),
    };
    (useCase as any).memberCache.clear();
    await useCase.execute(group(-777, '@nest_bot как дела?'));
    expect(pmAnswer.execute).toHaveBeenCalledTimes(1);
    telegram.isMember.mockResolvedValue(false);
  });

  it('still needs a mention or reply in a listed group', async () => {
    await useCase.execute(group(PM_GROUP, 'просто болтаем'));
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();

    repo.setFeedback.mockResolvedValueOnce(false);
    await useCase.execute({
      ...group(PM_GROUP, '👍', 8),
      callback: {
        id: 'cb2',
        messageId: 99,
        kind: 'feedback',
        vote: 1,
        token: 'abc123def456',
      },
    });
    expect(telegram.answerCallback).toHaveBeenLastCalledWith(
      'cb2',
      'Этот ответ уже оценён',
    );
  });

  it('turns /status into the status question', async () => {
    await useCase.execute({
      ...group(OWNER, '/status', OWNER),
      chatType: 'private',
    });
    expect(pmAnswer.execute.mock.calls[0][0]).toMatch(/How are we doing\?/);
  });

  it('lets only the owner force a refresh', async () => {
    await useCase.execute(group(PM_GROUP, '/refresh@nest_bot'));
    expect(pmRefresh.execute).not.toHaveBeenCalled();

    await useCase.execute(group(PM_GROUP, '/refresh@nest_bot', OWNER));
    expect(pmRefresh.execute).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      PM_GROUP,
      'Данные обновлены: issues ok',
    );
  });

  it('replays only pm turns as history, and keeps pm turns out of the persona', async () => {
    const log = (mode: string | null, text: string) =>
      new TelegramMessage(
        'id',
        new Date(),
        7,
        'dev',
        'Dev',
        null,
        PM_GROUP,
        'supergroup',
        'Team',
        text,
        `re: ${text}`,
        mode,
      );
    repo.findByChatId.mockResolvedValue([
      log('pm', 'pm question'),
      log(null, 'joke'),
    ]);

    await useCase.execute(group(PM_GROUP, '@nest_bot и что дальше?'));
    expect(pmAnswer.execute.mock.calls[0][1]).toEqual([
      { userText: 'Dev @dev: pm question', botResponse: 're: pm question' },
    ]);

    await useCase.execute({
      ...group(OWNER, 'привет', OWNER),
      chatType: 'private',
      chatId: 999,
    });
    const personaHistory = persona.generateReply.mock.calls[0]?.[1] ?? [];
    expect(personaHistory.map((t: { userText: string }) => t.userText)).toEqual(
      ['Dev @dev: joke'],
    );
  });

  it('lets the owner switch a group on with /pm_on, without an @mention', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_on', OWNER));
    expect(registry.enable).toHaveBeenCalledWith(OTHER_GROUP, 'Team');
    expect(telegram.sendMessage.mock.calls[0][1]).toMatch(/включён/);
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('ignores /pm_on from anyone but the owner, silently', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_on@nest_bot'));
    expect(registry.enable).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('ignores commands addressed to another bot', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_on@other_bot', OWNER));
    expect(registry.enable).not.toHaveBeenCalled();
  });

  it('answers as project manager in a group switched on at runtime', async () => {
    registry.isEnabled.mockResolvedValue(true);
    await useCase.execute(group(OTHER_GROUP, '/status'));
    expect(pmAnswer.execute).toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('switches a group off with /pm_off', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_off', OWNER));
    expect(registry.disable).toHaveBeenCalledWith(OTHER_GROUP);
  });

  it('appends the confirmation footer when the answer stored a proposal', async () => {
    pmAnswer.execute.mockResolvedValueOnce({
      text: 'Предлагаю создать бренд.',
      proposal: { id: 'K7Q2A', summary: 'Создать на STAGING бренд "X"' },
    });
    await useCase.execute(group(PM_GROUP, '@nest_bot создай бренд X'));
    const reply = telegram.sendMessage.mock.calls[0][1];
    expect(reply).toContain('Создать на STAGING бренд "X"');
    expect(reply).toContain('/confirm K7Q2A');
  });

  it('puts Confirm and Cancel buttons under a proposal', async () => {
    pmAnswer.execute.mockResolvedValueOnce({
      text: 'Предлагаю.',
      proposal: { id: 'K7Q2A', summary: 'Создать бренд' },
      choices: ['ignored'],
    });
    await useCase.execute(group(PM_GROUP, '@nest_bot создай бренд X'));
    expect(telegram.sendMessage.mock.calls[0][2]).toEqual([
      [
        { text: '✅ Подтвердить', data: 'c:K7Q2A' },
        { text: '❌ Отменить', data: 'x:K7Q2A' },
      ],
    ]);
  });

  it('sends offered choices as buttons and remembers them in the log', async () => {
    pmAnswer.execute.mockResolvedValueOnce({
      text: 'Какой молл? 1) Galleria 2) Park Avenue',
      proposal: null,
      choices: ['Galleria', 'Park Avenue'],
    });
    await useCase.execute(group(PM_GROUP, '@nest_bot создай бренд X'));
    expect(telegram.sendMessage.mock.calls[0][2]).toEqual([
      [{ text: 'Galleria', data: 'o:0' }],
      [{ text: 'Park Avenue', data: 'o:1' }],
    ]);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        botResponse: expect.stringContaining(
          '[Кнопки: Galleria | Park Avenue]',
        ),
      }),
    );
  });

  const press = (
    kind: 'confirm' | 'cancel' | 'option',
    text: string,
    fromId: number,
    chatId = PM_GROUP,
  ) => ({
    ...group(chatId, text, fromId),
    callback: { id: 'cb1', messageId: 99, kind },
  });

  it('acts on a picked option without a mention and clears the buttons', async () => {
    await useCase.execute(press('option', 'Выбираю вариант: Galleria', 7));
    expect(telegram.answerCallback).toHaveBeenCalledWith('cb1', 'Принято');
    expect(telegram.clearButtons).toHaveBeenCalledWith(PM_GROUP, 99);
    expect(pmAnswer.execute).toHaveBeenCalledWith(
      'Dev @dev: Выбираю вариант: Galleria',
      [],
      {
        chatId: PM_GROUP,
        requesterId: 7,
        requesterName: 'Dev @dev',
        canReadCode: false,
      },
    );
  });

  it('confirms from the button only for someone allowed to', async () => {
    await useCase.execute(press('confirm', '/confirm K7Q2A', 7));
    expect(telegram.answerCallback).toHaveBeenCalledWith(
      'cb1',
      'Нет прав на это действие',
    );
    expect(telegram.clearButtons).not.toHaveBeenCalled();
    expect(confirm.confirm).not.toHaveBeenCalled();

    await useCase.execute(press('confirm', '/confirm K7Q2A', OWNER));
    expect(telegram.clearButtons).toHaveBeenCalledWith(PM_GROUP, 99);
    expect(confirm.confirm).toHaveBeenCalledWith(
      'K7Q2A',
      PM_GROUP,
      OWNER,
      true,
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(PM_GROUP, 'Готово');
  });

  it('stores usage with the answer', async () => {
    pmAnswer.execute.mockResolvedValueOnce({
      text: 'ok',
      proposal: null,
      choices: [],
      usage: { model: 'm', outputTokens: 10, ms: 1200 },
    });
    await useCase.execute(group(PM_GROUP, '@nest_bot как дела?'));
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: { model: 'm', outputTokens: 10, ms: 1200 },
      }),
    );
  });

  it('records a 👎 from anyone in the chat, then removes the buttons', async () => {
    await useCase.execute({
      ...group(PM_GROUP, '👎', 7),
      callback: {
        id: 'cb1',
        messageId: 99,
        kind: 'feedback',
        vote: -1,
        token: 'abc123def456',
      },
    });
    expect(repo.setFeedback).toHaveBeenCalledWith(
      'abc123def456',
      PM_GROUP,
      -1,
      7,
    );
    expect(telegram.answerCallback).toHaveBeenCalledWith(
      'cb1',
      expect.stringContaining('учту'),
    );
    expect(telegram.clearButtons).toHaveBeenCalledWith(PM_GROUP, 99);
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('lists memory for anyone and lets only the authorised forget', async () => {
    const memory = {
      active: jest.fn().mockResolvedValue([
        {
          id: 'M7K2Q',
          kind: 'commitment',
          text: 'Ivan merges PR 12',
          dueAt: new Date('2026-09-25T23:59:59Z'),
        },
      ]),
      remove: jest.fn().mockResolvedValue(true),
      add: jest.fn(),
    };
    (useCase as any).pmMemory = memory;
    await useCase.execute(group(PM_GROUP, '/memory', 7));
    expect(telegram.sendMessage.mock.calls[0][1]).toContain(
      'M7K2Q · commitment, срок 2026-09-25 · Ivan merges PR 12',
    );
    await useCase.execute(group(PM_GROUP, '/forget M7K2Q', 7));
    expect(memory.remove).not.toHaveBeenCalled();
    await useCase.execute(group(PM_GROUP, '/forget m7k2q', OWNER));
    expect(memory.remove).toHaveBeenCalledWith('m7k2q');
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      PM_GROUP,
      'Забыл M7K2Q.',
    );
  });

  it('limits questions per day for everyone but the owner and listed people', async () => {
    const quota = { hit: jest.fn().mockResolvedValue(8) };
    (useCase as any).pmQuota = quota;
    (useCase as any).pmConfig = {
      ...(useCase as any).pmConfig,
      dailyQuestionLimit: 7,
      unlimitedUsernames: ['anna_z'],
    };
    await useCase.execute(group(PM_GROUP, '@nest_bot как дела?', 7));
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(telegram.sendMessage.mock.calls[0][1]).toContain(
      'Лимит 7 вопросов в день исчерпан',
    );

    await useCase.execute(group(PM_GROUP, '@nest_bot как дела?', OWNER));
    await useCase.execute({
      ...group(PM_GROUP, '@nest_bot как дела?', 9),
      from: { id: 9, username: 'Anna_Z', firstName: 'Anna', lastName: null },
    });
    expect(quota.hit).toHaveBeenCalledTimes(1);
    expect(pmAnswer.execute).toHaveBeenCalledTimes(2);
    expect(pmAnswer.execute.mock.calls[0][2]).toMatchObject({
      canReadCode: true,
    });
    expect(pmAnswer.execute.mock.calls[1][2]).toMatchObject({
      canReadCode: false,
    });

    // Commands never count
    await useCase.execute(group(PM_GROUP, '/confirm K7Q2A', 7));
    expect(quota.hit).toHaveBeenCalledTimes(1);
  });

  it('sends the admin link only to the owner, only in private', async () => {
    const links = {
      issue: jest.fn().mockResolvedValue('https://host/admin/#login=abc'),
      consume: jest.fn(),
    };
    (useCase as any).adminLinks = links;
    await useCase.execute({
      ...group(OWNER, '/admin', OWNER),
      chatType: 'private',
    });
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      OWNER,
      expect.stringContaining('https://host/admin/#login=abc'),
    );
    await useCase.execute(group(PM_GROUP, '/admin@nest_bot', OWNER));
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      PM_GROUP,
      expect.stringContaining('только в личку'),
    );
    telegram.sendMessage.mockClear();
    await useCase.execute({
      ...group(555, '/admin', 555),
      chatType: 'private',
      from: { id: 555, username: 'dmytro_aa', firstName: 'D', lastName: null },
    });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(links.issue).toHaveBeenCalledTimes(1);
  });

  it('uses the owner overrides from the admin page', async () => {
    (useCase as any).pmRuntime = {
      current: jest.fn().mockResolvedValue({
        ...(useCase as any).pmConfig,
        dmUsernames: ['ira92kr'],
      }),
    };
    await useCase.execute({
      ...group(777, 'привет', 777),
      chatType: 'private',
      from: { id: 777, username: 'ira92kr', firstName: 'Ira', lastName: null },
    });
    expect(pmAnswer.execute).toHaveBeenCalled();
  });

  it('lets only the owner answer an admin login prompt', async () => {
    const approvals = {
      create: jest.fn(),
      decide: jest.fn().mockResolvedValue('approved'),
      take: jest.fn(),
      deniedSince: jest.fn(),
    };
    (useCase as any).adminApprovals = approvals;
    const tap = (fromId: number) => ({
      ...group(fromId, '✅', fromId),
      chatType: 'private',
      callback: {
        id: 'cb9',
        messageId: 5,
        kind: 'approve' as const,
        approve: true,
        token: 'b'.repeat(32),
      },
    });
    await useCase.execute({
      ...tap(555),
      chatType: 'supergroup',
      chatId: PM_GROUP,
    });
    expect(approvals.decide).not.toHaveBeenCalled();
    await useCase.execute(tap(OWNER));
    expect(approvals.decide).toHaveBeenCalledWith(
      'b'.repeat(32),
      true,
      expect.any(Date),
    );
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      OWNER,
      'Вход в админку подтверждён.',
    );
    expect(pmAnswer.execute).not.toHaveBeenCalled();
  });

  it('keeps PM mode when Telegram turns the group into a supergroup', async () => {
    registry.isEnabled.mockImplementation(async (id: number) => id === -555);
    await useCase.execute({
      ...group(-100777, '', 0),
      text: null,
      chatTitle: 'Team',
      migrateFromChatId: -555,
    });
    expect(registry.enable).toHaveBeenCalledWith(-100777, 'Team');
    registry.enable.mockClear();
    await useCase.execute({
      ...group(-100888, '', 0),
      text: null,
      migrateFromChatId: -666,
    });
    expect(registry.enable).not.toHaveBeenCalled();
    registry.isEnabled.mockResolvedValue(false);
  });

  it('ignores button presses in a chat without PM mode', async () => {
    registry.isEnabled.mockResolvedValue(false);
    await useCase.execute(
      press('option', 'Выбираю вариант: X', OWNER, OTHER_GROUP),
    );
    expect(telegram.answerCallback).toHaveBeenCalledWith('cb1');
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('routes /confirm with the caller’s rights and never through the model', async () => {
    await useCase.execute(group(PM_GROUP, '/confirm K7Q2A', 7));
    expect(confirm.confirm).toHaveBeenCalledWith('K7Q2A', PM_GROUP, 7, false);
    await useCase.execute(group(PM_GROUP, '/confirm K7Q2A', OWNER));
    expect(confirm.confirm).toHaveBeenLastCalledWith(
      'K7Q2A',
      PM_GROUP,
      OWNER,
      true,
    );
    expect(pmAnswer.execute).not.toHaveBeenCalled();
  });

  it('treats a reply "да" to the bot as confirming the latest proposal', async () => {
    await useCase.execute({
      ...group(PM_GROUP, 'да', OWNER),
      replyToBotId: BOT.id,
    });
    expect(confirm.confirm).toHaveBeenCalledWith(null, PM_GROUP, OWNER, true);
  });

  it('routes /cancel', async () => {
    await useCase.execute(group(PM_GROUP, '/cancel K7Q2A', OWNER));
    expect(confirm.cancel).toHaveBeenCalledWith('K7Q2A', PM_GROUP, true);
  });

  it('sends a bare "да" to the model when nothing waits for confirmation', async () => {
    confirm.hasPending.mockResolvedValueOnce(false);
    await useCase.execute({
      ...group(PM_GROUP, 'да', OWNER),
      replyToBotId: BOT.id,
    });
    expect(confirm.confirm).not.toHaveBeenCalled();
    expect(pmAnswer.execute).toHaveBeenCalled();
  });

  it('answers listed team members in private as project manager', async () => {
    await useCase.execute({
      chatId: 555,
      chatType: 'private',
      chatTitle: null,
      text: 'как дела по релизу?',
      from: {
        id: 555,
        username: 'Dmytro_AA',
        firstName: 'Dmytro',
        lastName: null,
      },
    });
    expect(pmAnswer.execute).toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('still ignores private messages from anyone else', async () => {
    await useCase.execute({
      chatId: 777,
      chatType: 'private',
      chatTitle: null,
      text: 'привет',
      from: { id: 777, username: 'stranger', firstName: 'S', lastName: null },
    });
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('does not let a team member confirm actions unless allowed', async () => {
    await useCase.execute({
      chatId: 555,
      chatType: 'private',
      chatTitle: null,
      text: '/confirm K7Q2A',
      from: {
        id: 555,
        username: 'dmytro_aa',
        firstName: 'Dmytro',
        lastName: null,
      },
    });
    expect(confirm.confirm).toHaveBeenCalledWith('K7Q2A', 555, 555, false);
  });

  it('ignores a bare PM command in a group without PM mode', async () => {
    registry.isEnabled.mockResolvedValue(false);
    await useCase.execute(group(OTHER_GROUP, '/status'));
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('treats "ок" from someone without rights as a normal answer', async () => {
    await useCase.execute({
      ...group(PM_GROUP, 'ок', 7),
      replyToBotId: BOT.id,
    });
    expect(confirm.confirm).not.toHaveBeenCalled();
    expect(pmAnswer.execute).toHaveBeenCalled();
  });
});
