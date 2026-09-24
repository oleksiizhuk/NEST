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
