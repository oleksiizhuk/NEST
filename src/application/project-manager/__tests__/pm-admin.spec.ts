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
      ]),
    };
    const chats = {
      isEnabled: jest.fn(async (id: number) => id === -300),
      enable: jest.fn(),
      disable: jest.fn(),
      digestChats: jest.fn(),
    };
    const admin = new PmAdminUseCase(
      store,
      runtime,
      quota,
      messages as any,
      chats,
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
    expect(groups.map((g) => [g.chatId, g.on, g.fixed])).toEqual([
      [1, true, true],
      [-300, true, false],
      [-400, false, false],
    ]);
    await admin.setGroup(-400, true);
    expect(chats.enable).toHaveBeenCalledWith(-400, 'New team chat');
    await expect(admin.setGroup(-999, true)).rejects.toThrow('unknown chat');
  });
});
