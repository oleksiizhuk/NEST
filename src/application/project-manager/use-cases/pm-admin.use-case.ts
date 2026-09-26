import { Inject, Injectable } from '@nestjs/common';
import {
  SettingsError,
  cleanSettings,
  IPmSettingsStore,
  PM_SETTINGS,
  PmSettings,
  SETTING_KEYS,
} from '@application/project-manager/settings.interface';
import { PmRuntimeConfig } from '@application/project-manager/pm-runtime-config';
import {
  DEFAULT_THRESHOLDS,
  todayItems,
} from '@application/project-manager/team';
import { TeamReviewUseCase } from '@application/project-manager/use-cases/team-review.use-case';
import { IQuota, PM_QUOTA } from '@application/project-manager/quota.interface';
import {
  ITelegramMessageRepository,
  TELEGRAM_MESSAGE_REPOSITORY,
} from '@domain/telegram/telegram-message.repository.interface';
import { summarizeAnswers } from '@application/project-manager/answer-stats';
import {
  IPmChatRegistry,
  PM_CHAT_REGISTRY,
} from '@application/project-manager/pm-chat-registry.interface';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import {
  ITelegramConfig,
  TELEGRAM_CONFIG,
} from '@application/telegram/telegram.config.interface';

// What the admin page reads and changes. Only the owner reaches it (guard).
@Injectable()
export class PmAdminUseCase {
  constructor(
    @Inject(PM_SETTINGS) private readonly store: IPmSettingsStore,
    private readonly runtime: PmRuntimeConfig,
    @Inject(PM_QUOTA) private readonly quota: IQuota,
    @Inject(TELEGRAM_MESSAGE_REPOSITORY)
    private readonly messages: ITelegramMessageRepository,
    @Inject(PM_CHAT_REGISTRY) private readonly chats: IPmChatRegistry,
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(TELEGRAM_CONFIG) private readonly telegramConfig: ITelegramConfig,
    private readonly team: TeamReviewUseCase,
  ) {}

  // Groups the bot has seen and their PM mode:
  // fixed (TELEGRAM_PM_CHAT_IDS) · on / off (switched explicitly) ·
  // auto (the owner is in the group and automatic mode is on) · none
  async groups() {
    const live = await this.runtime.current();
    const fixed = this.runtime.defaults().chatIds;
    const seen = await this.messages.recentGroups(30);
    let digestList: number[] = [];
    try {
      digestList = (await this.chats.digestChats()) ?? [];
    } catch {
      // shown as "no digest"; the rest of the page still loads
    }
    const digestChats = new Set(digestList);
    const base = this.runtime.defaults();
    const alertChats = live.alertChatIds ?? [];
    return Promise.all(
      seen.map(async (g) => {
        let mode: 'fixed' | 'on' | 'off' | 'auto' | 'none' | 'unknown';
        if (fixed.includes(g.chatId)) mode = 'fixed';
        else if (await this.chats.isEnabled(g.chatId).catch(() => false))
          mode = 'on';
        else if (await this.chats.isDisabled(g.chatId).catch(() => false))
          mode = 'off';
        else if (live.pmInOwnerGroups === false) mode = 'none';
        else {
          const member = await this.ownerIn(g.chatId);
          mode = member === null ? 'unknown' : member ? 'auto' : 'none';
        }
        const on = mode === 'fixed' || mode === 'on' || mode === 'auto';
        return {
          ...g,
          mode,
          fixed: mode === 'fixed',
          on,
          // The weekday digest goes to chats switched on explicitly and to
          // PM_DIGEST_CHAT_ID; automatic mode alone does not subscribe
          digest: digestChats.has(g.chatId) || base.digestChatId === g.chatId,
          alerts: alertChats.includes(g.chatId),
        };
      }),
    );
  }

  // Jira name → GitHub login on the Сотрудники page
  async setGithubLogin(name: string, login: string | null, by: number) {
    // From the store, not the 30 s cache: another instance may have saved a
    // link a moment ago
    const current = { ...((await this.store.get()).values.githubLogins ?? {}) };
    if (login) current[name] = login.trim();
    else delete current[name];
    await this.store.save(cleanSettings({ githubLogins: current }), by);
    this.runtime.invalidate();
  }

  // Jira name → Telegram username on the Сотрудники page
  async setTelegramUsername(name: string, username: string | null, by: number) {
    const current = {
      ...((await this.store.get()).values.telegramUsernames ?? {}),
    };
    if (username) current[name] = username;
    else delete current[name];
    await this.store.save(cleanSettings({ telegramUsernames: current }), by);
    this.runtime.invalidate();
  }

  // "Написать в чат": the owner's message to a PM group the bot works in,
  // with the person mentioned when their username is linked
  async nudge(name: string, text: string, chatId: number) {
    const message = String(text ?? '').trim();
    if (!message || message.length > 800)
      throw new SettingsError('text: 1-800 characters');
    const chat = (await this.groups()).find((g) => g.chatId === chatId && g.on);
    if (!chat) throw new SettingsError('chat: a PM group the bot works in');
    // From the store: a link saved a moment ago may not be in the cache
    const username = (await this.store.get()).values.telegramUsernames?.[name];
    const to = username ? `@${username}` : name;
    await this.telegram.sendMessage(chatId, `${to}, ${message}`);
    return { sent: true, chatId, mention: Boolean(username) };
  }

  // Marks a person away until a date (inclusive); null brings them back
  async setAway(
    name: string,
    until: string | null,
    note: string | null,
    by: number,
  ) {
    const clean = until
      ? cleanSettings({ teamAway: { [name]: { until, note } } }).teamAway?.[
          name
        ]
      : null;
    await this.store.setAway(
      name,
      clean ? { until: clean.until, note: clean.note ?? null } : null,
      by,
    );
    this.runtime.invalidate();
  }

  // Сегодня: the top signals across the team, minus what the owner hid
  async today(now = new Date()) {
    const [team, { values }] = await Promise.all([
      this.team.team(now),
      this.store.get(),
    ]);
    const at = now.toISOString();
    const hidden = new Set(
      (values.todayHidden ?? []).filter((h) => h.until > at).map((h) => h.id),
    );
    if (!team) return { asOf: null, links: null, items: [], more: 0 };
    return {
      asOf: team.asOf,
      links: team.links,
      releaseVersion: team.releaseVersion,
      ...todayItems(team.people, hidden),
    };
  }

  // "Готово" hides an item for a week, "Отложить" for 24 hours, counted
  // from the click; if the problem is still in the data after that, it
  // comes back
  async hideToday(id: string, days: number, by: number, now = new Date()) {
    if (!id || id.length > 300) throw new SettingsError('bad item id');
    if (![1, 7].includes(days)) throw new SettingsError('days: 1 or 7');
    const until = new Date(now.getTime() + days * 86_400_000).toISOString();
    await this.store.hideToday(id, until, now.toISOString(), by);
    return this.today(now);
  }

  // Adds or removes a chat from the alert recipients (an override of the
  // env list, like the field in the settings form)
  async setAlerts(chatId: number, on: boolean, by: number) {
    const stored = (await this.store.get()).values.alertChatIds;
    const current = stored ?? this.runtime.defaults().alertChatIds ?? [];
    const next = on
      ? [...new Set([...current, chatId])]
      : current.filter((id) => id !== chatId);
    await this.store.save({ alertChatIds: next }, by);
    this.runtime.invalidate();
    return this.groups();
  }

  // Owner membership per group, cached for 10 minutes; null when Telegram
  // could not tell (shown as "unknown", never as "off")
  private readonly memberCache = new Map<
    number,
    { at: number; yes: boolean }
  >();

  private async ownerIn(chatId: number): Promise<boolean | null> {
    const ownerId = this.telegramConfig.ownerId;
    if (!ownerId) return false;
    const cached = this.memberCache.get(chatId);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.yes;
    try {
      const yes = await this.telegram.isMember(chatId, ownerId);
      this.memberCache.set(chatId, { at: Date.now(), yes });
      return yes;
    } catch {
      return cached?.yes ?? null;
    }
  }

  // Same as /pm_on and /pm_off from the admin page ("auto" = back to the
  // default); only for chats the bot has actually seen
  async setGroup(chatId: number, on: boolean | 'auto') {
    const seen = (await this.messages.recentGroups(200)).find(
      (g) => g.chatId === chatId,
    );
    if (!seen) throw new SettingsError('unknown chat');
    if (on === 'auto') await this.chats.clear(chatId);
    else if (on) await this.chats.enable(chatId, seen.title);
    else await this.chats.disable(chatId);
    return this.groups();
  }

  async settings() {
    const base = this.runtime.defaults();
    const { values, updatedAt } = await this.store.get();
    const defaults: Required<Record<keyof PmSettings, unknown>> = {
      dailyQuestionLimit: base.dailyQuestionLimit ?? 7,
      unlimitedUsernames: base.unlimitedUsernames ?? [],
      dmUsernames: base.dmUsernames,
      actionUserIds: base.actionUserIds,
      alertChatIds: base.alertChatIds ?? [],
      aiEffort: base.aiEffort ?? null,
      pmInOwnerGroups: base.pmInOwnerGroups !== false,
      githubLogins: {},
      teamThresholds: DEFAULT_THRESHOLDS,
      teamAway: {},
      releaseBaseline: null,
      telegramUsernames: {},
      todayHidden: [],
    };
    const overrides: PmSettings = {};
    for (const key of SETTING_KEYS) {
      if (values[key] !== undefined && values[key] !== null)
        (overrides as Record<string, unknown>)[key] = values[key];
    }
    return { defaults, overrides, updatedAt };
  }

  async update(input: Record<string, unknown>, by: number) {
    await this.store.save(cleanSettings(input), by);
    this.runtime.invalidate();
    return this.settings();
  }

  async usage(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    const [questions, answers, live] = await Promise.all([
      this.quota.day(day),
      this.messages.recentAnswers(100),
      this.runtime.current(),
    ]);
    return {
      day,
      limit: live.dailyQuestionLimit ?? 0,
      questions,
      feedback: summarizeAnswers(answers),
    };
  }
}
