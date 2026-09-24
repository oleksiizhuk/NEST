import { IPmConfig } from '@application/project-manager/pm.config.interface';

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
}

export const SETTING_KEYS: Array<keyof PmSettings> = [
  'dailyQuestionLimit',
  'unlimitedUsernames',
  'dmUsernames',
  'actionUserIds',
  'alertChatIds',
  'aiEffort',
  'pmInOwnerGroups',
];

export interface IPmSettingsStore {
  get(): Promise<{ values: PmSettings; updatedAt: Date | null }>;
  save(values: PmSettings, by: number): Promise<void>;
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
});
