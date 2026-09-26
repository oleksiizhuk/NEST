import {
  cleanSettings,
  resolveConfig,
} from '@application/project-manager/settings.interface';
import { PmRuntimeConfig } from '@application/project-manager/pm-runtime-config';
import { PmAdminUseCase } from '@application/project-manager/use-cases/pm-admin.use-case';

const base = {
  chatIds: [1],
  digestChatId: null,
  releaseDate: null,
  projectBrief: '',
  maxSnapshotAgeHours: 30,
  actionUserIds: [1],
  dmUsernames: ['dev_one'],
  team: [],
  dailyQuestionLimit: 7,
  unlimitedUsernames: ['anna_z'],
  alertChatIds: [1],
};

describe('settings', () => {
  it('validates and normalises what the admin page sends', () => {
    expect(
      cleanSettings({
        dailyQuestionLimit: '10',
        unlimitedUsernames: ['@Anna_Z', 'anna_z'],
        actionUserIds: ['42', 7],
        aiEffort: null,
      }),
    ).toEqual({
      dailyQuestionLimit: 10,
      unlimitedUsernames: ['anna_z'],
      actionUserIds: [42, 7],
      aiEffort: null,
    });
    expect(() => cleanSettings({ dailyQuestionLimit: -1 })).toThrow('0-1000');
    expect(() => cleanSettings({ dmUsernames: ['a b'] })).toThrow(
      'not a Telegram username',
    );
    expect(() => cleanSettings({ aiEffort: 'turbo' })).toThrow('aiEffort');
    expect(() => cleanSettings({ projectBrief: 'x' })).toThrow(
      'unknown setting',
    );
  });

  it('puts overrides over the env config; null keeps the env value', () => {
    const config = resolveConfig(base, {
      dailyQuestionLimit: 0,
      dmUsernames: null,
      aiEffort: 'medium',
    });
    expect(config.dailyQuestionLimit).toBe(0);
    expect(config.dmUsernames).toEqual(['dev_one']);
    expect(config.aiEffort).toBe('medium');
    expect(config.unlimitedUsernames).toEqual(['anna_z']);
  });
});

describe('PmRuntimeConfig', () => {
  it('caches for 30 s, re-reads after invalidate, falls back to env on errors', async () => {
    const store = {
      get: jest.fn().mockResolvedValue({
        values: { dailyQuestionLimit: 3 },
        updatedAt: null,
      }),
      save: jest.fn(),
      sessionEpoch: jest.fn().mockResolvedValue(0),
      bumpSessionEpoch: jest.fn(),
      setAway: jest.fn(),
      hideToday: jest.fn(),
    };
    const runtime = new PmRuntimeConfig(base, store);
    expect((await runtime.current(1_000)).dailyQuestionLimit).toBe(3);
    await runtime.current(20_000);
    expect(store.get).toHaveBeenCalledTimes(1);
    runtime.invalidate();
    store.get.mockRejectedValueOnce(new Error('down'));
    expect((await runtime.current(21_000)).dailyQuestionLimit).toBe(7);
  });
});

describe('PmAdminUseCase', () => {
  it('shows env defaults and overrides, saves by merging, reports usage', async () => {
    const store = {
      get: jest.fn().mockResolvedValue({
        values: { dailyQuestionLimit: 3, dmUsernames: null },
        updatedAt: null,
      }),
      save: jest.fn(),
      sessionEpoch: jest.fn().mockResolvedValue(0),
      bumpSessionEpoch: jest.fn(),
      setAway: jest.fn(),
      hideToday: jest.fn(),
    };
    const runtime = new PmRuntimeConfig(base, store);
    const quota = {
      hit: jest.fn(),
      day: jest
        .fn()
        .mockResolvedValue([{ userId: 5, username: 'dev_one', count: 4 }]),
    };
    const messages = {
      recentAnswers: jest.fn().mockResolvedValue([]),
      recentGroups: jest.fn().mockResolvedValue([
        { chatId: 1, title: 'Fixed', lastAt: new Date() },
        { chatId: -300, title: 'Team', lastAt: new Date() },
        { chatId: -400, title: 'New team chat', lastAt: new Date() },
        { chatId: -500, title: 'Owner is here', lastAt: new Date() },
      ]),
    };
    const chats = {
      isEnabled: jest.fn(async (id: number) => id === -300),
      enable: jest.fn(),
      disable: jest.fn(),
      isDisabled: jest.fn().mockResolvedValue(false),
      clear: jest.fn(),
      digestChats: jest.fn(),
    };
    const telegram = {
      isMember: jest.fn(async (chatId: number) => chatId === -500),
    };
    const admin = new PmAdminUseCase(
      store,
      runtime,
      quota,
      messages as any,
      chats,
      telegram as any,
      { ownerId: 42 } as any,
      { team: jest.fn() } as any,
    );
    const settings = await admin.settings();
    expect(settings.defaults.dailyQuestionLimit).toBe(7);
    expect(settings.overrides).toEqual({ dailyQuestionLimit: 3 });

    await admin.update({ dailyQuestionLimit: 9 }, 1);
    expect(store.save).toHaveBeenCalledWith({ dailyQuestionLimit: 9 }, 1);
    await expect(admin.update({ nope: 1 }, 1)).rejects.toThrow('unknown');

    const usage = await admin.usage(new Date('2026-09-23T10:00:00Z'));
    expect(usage).toMatchObject({
      day: '2026-09-23',
      limit: 3,
      questions: [{ userId: 5, username: 'dev_one', count: 4 }],
      feedback: { answers: 0 },
    });
    expect(quota.day).toHaveBeenCalledWith('2026-09-23');

    const groups = await admin.groups();
    expect(groups.map((g) => [g.chatId, g.mode, g.on])).toEqual([
      [1, 'fixed', true],
      [-300, 'on', true],
      [-400, 'none', false],
      [-500, 'auto', true],
    ]);
    await admin.setGroup(-500, 'auto');
    expect(chats.clear).toHaveBeenCalledWith(-500);
    // base alertChatIds is [1]; digest follows explicit switches
    chats.digestChats.mockResolvedValue([-300]);
    const withFlags = await admin.groups();
    expect(withFlags.map((g) => [g.chatId, g.digest, g.alerts])).toEqual([
      [1, false, true],
      [-300, true, false],
      [-400, false, false],
      [-500, false, false],
    ]);
    store.get.mockResolvedValue({ values: {}, updatedAt: null });
    runtime.invalidate();
    // Membership Telegram cannot confirm is "unknown", not "off"
    const member = telegram.isMember.getMockImplementation();
    telegram.isMember.mockImplementation(async (chatId: number) => {
      if (chatId === -500) throw new Error('429');
      return false;
    });
    (admin as any).memberCache.clear();
    const flaky = await admin.groups();
    expect(flaky.find((g) => g.chatId === -500)?.mode).toBe('unknown');
    telegram.isMember.mockImplementation(member as any);

    // GitHub links are read from the store, not the 30 s cache
    store.get.mockResolvedValue({
      values: { githubLogins: { 'Ann Lee': 'ann' } },
      updatedAt: null,
    });
    await admin.setGithubLogin('J. Smith', 'jsmith', 42);
    expect(store.save).toHaveBeenLastCalledWith(
      { githubLogins: { 'Ann Lee': 'ann', 'J. Smith': 'jsmith' } },
      42,
    );
    store.get.mockResolvedValue({ values: {}, updatedAt: null });
    await admin.setAlerts(-300, true, 42);
    expect(store.save).toHaveBeenLastCalledWith(
      { alertChatIds: [1, -300] },
      42,
    );
    await admin.setGroup(-400, true);
    expect(chats.enable).toHaveBeenCalledWith(-400, 'New team chat');
    await expect(admin.setGroup(-999, true)).rejects.toThrow('unknown chat');
  });
});

describe('PmAdminUseCase — Сегодня and absences', () => {
  const setup = (values: Record<string, unknown>) => {
    const store = {
      get: jest.fn().mockResolvedValue({ values, updatedAt: null }),
      save: jest.fn(),
      sessionEpoch: jest.fn(),
      bumpSessionEpoch: jest.fn(),
      setAway: jest.fn(),
      hideToday: jest.fn(),
    };
    const signal = (rule: string, key: string) => ({
      level: 'warn',
      rule,
      text: `${rule} ${key}`,
      keys: [key],
    });
    const person = {
      name: 'Ann',
      inProgress: [],
      queue: [{ key: 'A-1', inScope: true }],
      signals: [signal('blocked', 'A-1'), signal('stale', 'A-2')],
    };
    const team = {
      team: jest.fn().mockResolvedValue({
        asOf: new Date(),
        links: { jira: null, githubOrg: null },
        releaseVersion: '1.0',
        people: [person],
      }),
    };
    const admin = new PmAdminUseCase(
      store as any,
      new PmRuntimeConfig(base, store as any),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { ownerId: 42 } as any,
      team as any,
    );
    return { admin, store };
  };
  const NOW = new Date('2026-09-24T10:00:00Z');

  it('lists signals, minus items hidden until a later time', async () => {
    const { admin } = setup({
      todayHidden: [
        { id: 'stale|Ann|A-2', until: '2026-09-24T12:00:00.000Z' },
        { id: 'blocked|Ann|A-1', until: '2026-09-24T09:00:00.000Z' },
      ],
    });
    const today = await admin.today(NOW);
    expect(today.items.map((i) => i.id)).toEqual(['blocked|Ann|A-1']);
    expect(today.items[0].inRelease).toBe(true);
  });

  it('hides for 24 hours or a week from the click, in one store call', async () => {
    const { admin, store } = setup({});
    await admin.hideToday('stale|Ann|A-2', 1, 42, NOW);
    expect(store.hideToday).toHaveBeenCalledWith(
      'stale|Ann|A-2',
      '2026-09-25T10:00:00.000Z',
      '2026-09-24T10:00:00.000Z',
      42,
    );
    await admin.hideToday('x', 7, 42, NOW);
    expect(store.hideToday).toHaveBeenLastCalledWith(
      'x',
      '2026-10-01T10:00:00.000Z',
      '2026-09-24T10:00:00.000Z',
      42,
    );
    await expect(admin.hideToday('x', 3, 42, NOW)).rejects.toThrow('days');
  });

  it('marks one person away and back without rewriting the others', async () => {
    const { admin, store } = setup({});
    await admin.setAway('Ann', '2026-10-02', 'отпуск', 42);
    expect(store.setAway).toHaveBeenCalledWith(
      'Ann',
      { until: '2026-10-02', note: 'отпуск' },
      42,
    );
    await admin.setAway('Ann', null, null, 42);
    expect(store.setAway).toHaveBeenLastCalledWith('Ann', null, 42);
    await expect(admin.setAway('Ann', '2 Oct', null, 42)).rejects.toThrow(
      'YYYY-MM-DD',
    );
    expect(store.save).not.toHaveBeenCalled();
  });

  it('sends a nudge to a PM group, mentioning a linked person', async () => {
    const { admin, store } = setup({ telegramUsernames: { Ann: 'ann_k' } });
    const telegram = { sendMessage: jest.fn() };
    (admin as any).telegram = telegram;
    jest.spyOn(admin, 'groups').mockResolvedValue([
      { chatId: -5, on: true },
      { chatId: -6, on: false },
    ] as any);
    await admin.nudge('Ann', 'что мешает закрыть A-1?', -5);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      -5,
      '@ann_k, что мешает закрыть A-1?',
    );
    await admin.nudge('Bob', 'привет', -5);
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(-5, 'Bob, привет');
    await expect(admin.nudge('Ann', 'x', -6)).rejects.toThrow('PM group');
    await expect(admin.nudge('Ann', ' ', -5)).rejects.toThrow('text');
    await admin.setTelegramUsername('Bob', '@Bob_Dev', 42);
    expect(store.save).toHaveBeenLastCalledWith(
      { telegramUsernames: { Ann: 'ann_k', Bob: 'bob_dev' } },
      42,
    );
  });
});
