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
    return Promise.all(
      seen.map(async (g) => {
        let mode: 'fixed' | 'on' | 'off' | 'auto' | 'none';
        if (fixed.includes(g.chatId)) mode = 'fixed';
        else if (await this.chats.isEnabled(g.chatId).catch(() => false))
          mode = 'on';
        else if (await this.chats.isDisabled(g.chatId).catch(() => false))
          mode = 'off';
        else if (
          live.pmInOwnerGroups !== false &&
          this.telegramConfig.ownerId &&
          (await this.telegram
            .isMember(g.chatId, this.telegramConfig.ownerId)
            .catch(() => false))
        )
          mode = 'auto';
        else mode = 'none';
        return {
          ...g,
          mode,
          fixed: mode === 'fixed',
          on: mode === 'fixed' || mode === 'on' || mode === 'auto',
        };
      }),
    );
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
