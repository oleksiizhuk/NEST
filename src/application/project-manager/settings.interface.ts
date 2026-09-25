import { IPmConfig } from '@application/project-manager/pm.config.interface';
import {
  SignalRule,
  TeamAway,
  TeamThresholds,
  TOGGLEABLE_RULES,
} from '@application/project-manager/team';

export const PM_SETTINGS = 'PM_SETTINGS';

export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

// What the owner can change at runtime from the admin page. A missing or
// null field means "use the value from the environment".
export interface PmSettings {
  dailyQuestionLimit?: number | null;
  unlimitedUsernames?: string[] | null;
  dmUsernames?: string[] | null;
  actionUserIds?: number[] | null;
  alertChatIds?: number[] | null;
  aiEffort?: AiEffort | null;
  // Every group the owner is in gets PM mode without /pm_on
  pmInOwnerGroups?: boolean | null;
  // Jira display name → GitHub login, for the Сотрудники page
  githubLogins?: Record<string, string> | null;
  // Сотрудники: signal thresholds and rules switched off
  teamThresholds?: TeamThresholds | null;
  // Jira display name → away until (inclusive), so signals stay quiet
  teamAway?: TeamAway | null;
  // "Сегодня" items the owner marked done or snoozed, until an ISO time.
  // Written by its own endpoint, not through the settings form.
  todayHidden?: Array<{ id: string; until: string }> | null;
}

export const SETTING_KEYS: Array<keyof PmSettings> = [
  'dailyQuestionLimit',
  'unlimitedUsernames',
  'dmUsernames',
  'actionUserIds',
  'alertChatIds',
  'aiEffort',
  'pmInOwnerGroups',
  'githubLogins',
  'teamThresholds',
  'teamAway',
];

export interface IPmSettingsStore {
  get(): Promise<{ values: PmSettings; updatedAt: Date | null }>;
  save(values: PmSettings, by: number): Promise<void>;
  // One person's absence (null removes it), without touching the others
  setAway(
    name: string,
    away: { until: string; note: string | null } | null,
    by: number,
  ): Promise<void>;
  // Adds or replaces one hidden "Сегодня" item and drops expired ones,
  // atomically, so two quick clicks cannot overwrite each other
  hideToday(id: string, until: string, now: string, by: number): Promise<void>;
  // Admin sessions carry this number; raising it logs every session out
  sessionEpoch(): Promise<number>;
  bumpSessionEpoch(): Promise<number>;
}

// A bad value from the admin page (a 400, unlike a storage failure)
export class SettingsError extends Error {}

const USERNAME = /^[a-z0-9_]{4,32}$/;

const usernames = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value))
    throw new SettingsError(`${field}: a list of usernames`);
  const cleaned = value.map((v) =>
    String(v ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase(),
  );
  const bad = cleaned.find((u) => !USERNAME.test(u));
  if (bad !== undefined)
    throw new Error(`${field}: "${bad}" is not a Telegram username`);
  return [...new Set(cleaned)].slice(0, 50);
};

const telegramIds = (value: unknown, field: string): number[] => {
  if (!Array.isArray(value))
    throw new Error(`${field}: a list of Telegram ids`);
  const ids = value.map((v) => Number(v));
  if (ids.some((n) => !Number.isSafeInteger(n) || n === 0))
    throw new SettingsError(`${field}: ids are non-zero integers`);
  return [...new Set(ids)].slice(0, 50);
};

// Validates an update from the admin page; null resets a field to the env
export const cleanSettings = (input: Record<string, unknown>): PmSettings => {
  const out: PmSettings = {};
  for (const key of Object.keys(input)) {
    if (!SETTING_KEYS.includes(key as keyof PmSettings))
      throw new SettingsError(`unknown setting ${key}`);
  }
  const has = (k: keyof PmSettings) =>
    Object.prototype.hasOwnProperty.call(input, k);
  const nil = (k: keyof PmSettings) => input[k] === null;
  if (has('dailyQuestionLimit')) {
    if (nil('dailyQuestionLimit')) out.dailyQuestionLimit = null;
    else {
      const n = Number(input.dailyQuestionLimit);
      if (!Number.isInteger(n) || n < 0 || n > 1000)
        throw new SettingsError('dailyQuestionLimit: 0-1000 (0 = no limit)');
      out.dailyQuestionLimit = n;
    }
  }
  for (const k of ['unlimitedUsernames', 'dmUsernames'] as const) {
    if (has(k)) out[k] = nil(k) ? null : usernames(input[k], k);
  }
  for (const k of ['actionUserIds', 'alertChatIds'] as const) {
    if (has(k)) out[k] = nil(k) ? null : telegramIds(input[k], k);
  }
  if (has('aiEffort')) {
    if (nil('aiEffort')) out.aiEffort = null;
    else if (!AI_EFFORTS.includes(input.aiEffort as AiEffort))
      throw new SettingsError(`aiEffort: one of ${AI_EFFORTS.join(', ')}`);
    else out.aiEffort = input.aiEffort as AiEffort;
  }
  if (has('githubLogins')) {
    const value = input.githubLogins;
    if (value === null) out.githubLogins = null;
    else if (typeof value !== 'object' || Array.isArray(value))
      throw new SettingsError('githubLogins: an object name → login');
    else {
      const map: Record<string, string> = {};
      for (const [name, login] of Object.entries(
        value as Record<string, unknown>,
      )) {
        // Stored as a list of pairs, so any display name works ("J. Smith")
        if (!name.trim() || name.length > 100)
          throw new SettingsError(`githubLogins: bad name "${name}"`);
        if (typeof login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(login))
          throw new SettingsError(`githubLogins: bad login for ${name}`);
        map[name] = login;
      }
      out.githubLogins = map;
    }
  }
  if (has('teamThresholds')) {
    const value = input.teamThresholds as Record<string, unknown> | null;
    if (value === null) out.teamThresholds = null;
    else if (typeof value !== 'object' || Array.isArray(value))
      throw new SettingsError('teamThresholds: an object');
    else {
      const int = (k: string, min: number, max: number) => {
        const n = Number(value[k]);
        if (!Number.isInteger(n) || n < min || n > max)
          throw new SettingsError(`teamThresholds.${k}: ${min}-${max}`);
        return n;
      };
      const off = value.off ?? [];
      if (
        !Array.isArray(off) ||
        off.some((r) => !TOGGLEABLE_RULES.includes(r as SignalRule))
      )
        throw new SettingsError(
          `teamThresholds.off: any of ${TOGGLEABLE_RULES.join(', ')}`,
        );
      out.teamThresholds = {
        wipLimit: int('wipLimit', 1, 10),
        staleDays: int('staleDays', 1, 30),
        reviewWaitDays: int('reviewWaitDays', 1, 14),
        off: [...new Set(off as SignalRule[])],
      };
    }
  }
  if (has('teamAway')) {
    const value = input.teamAway;
    if (value === null) out.teamAway = null;
    else if (typeof value !== 'object' || Array.isArray(value))
      throw new SettingsError('teamAway: an object name → { until, note }');
    else {
      const map: TeamAway = {};
      for (const [name, raw] of Object.entries(
        value as Record<string, { until?: unknown; note?: unknown }>,
      )) {
        if (!name.trim() || name.length > 100)
          throw new SettingsError(`teamAway: bad name "${name}"`);
        const until = String(raw?.until ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || isNaN(Date.parse(until)))
          throw new SettingsError(`teamAway: date YYYY-MM-DD for ${name}`);
        const note = raw?.note == null ? '' : String(raw.note).trim();
        if (note.length > 60)
          throw new SettingsError(`teamAway: note up to 60 chars`);
        map[name] = { until, note: note || null };
      }
      out.teamAway = map;
    }
  }
  if (has('pmInOwnerGroups')) {
    if (nil('pmInOwnerGroups')) out.pmInOwnerGroups = null;
    else if (typeof input.pmInOwnerGroups !== 'boolean')
      throw new SettingsError('pmInOwnerGroups: true or false');
    else out.pmInOwnerGroups = input.pmInOwnerGroups;
  }
  return out;
};

// The env config with the owner's overrides on top
export const resolveConfig = (base: IPmConfig, s: PmSettings): IPmConfig => ({
  ...base,
  ...(s.dailyQuestionLimit != null
    ? { dailyQuestionLimit: s.dailyQuestionLimit }
    : {}),
  ...(s.unlimitedUsernames != null
    ? { unlimitedUsernames: s.unlimitedUsernames }
    : {}),
  ...(s.dmUsernames != null ? { dmUsernames: s.dmUsernames } : {}),
  ...(s.actionUserIds != null ? { actionUserIds: s.actionUserIds } : {}),
  ...(s.alertChatIds != null ? { alertChatIds: s.alertChatIds } : {}),
  ...(s.aiEffort != null ? { aiEffort: s.aiEffort } : {}),
  ...(s.pmInOwnerGroups != null ? { pmInOwnerGroups: s.pmInOwnerGroups } : {}),
  ...(s.githubLogins != null ? { githubLogins: s.githubLogins } : {}),
  ...(s.teamThresholds != null ? { teamThresholds: s.teamThresholds } : {}),
  ...(s.teamAway != null ? { teamAway: s.teamAway } : {}),
});
