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
  ) {}

  // Groups the bot has seen and whether PM mode is on there. "fixed" = set
  // by TELEGRAM_PM_CHAT_IDS and not switchable here.
  async groups() {
    const fixed = this.runtime.defaults().chatIds;
    const seen = await this.messages.recentGroups(30);
    return Promise.all(
      seen.map(async (g) => ({
        ...g,
        fixed: fixed.includes(g.chatId),
        on:
          fixed.includes(g.chatId) ||
          (await this.chats.isEnabled(g.chatId).catch(() => false)),
      })),
    );
  }

  // Same as /pm_on and /pm_off, from the admin page; only for chats the
  // bot has actually seen
  async setGroup(chatId: number, on: boolean) {
    const seen = (await this.messages.recentGroups(200)).find(
      (g) => g.chatId === chatId,
    );
    if (!seen) throw new SettingsError('unknown chat');
    if (on) await this.chats.enable(chatId, seen.title);
    else await this.chats.disable(chatId);
    return this.groups();
  }

  // Env values, the owner's overrides, and what is in effect
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
