// Talks to /pm-admin on the same origin. The session lives in this
// browser only; a 401 means it expired or was never there.
const SESSION_KEY = 'pm-admin-session';

export class Unauthorized extends Error {}

export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(value: string): void {
    try {
      localStorage.setItem(SESSION_KEY, value);
    } catch {
      // private mode: the session lasts for this tab only
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // nothing stored
    }
  },
};

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = session.get();
  const res = await fetch(`/pm-admin/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A wrong password is a 401 too, but the page should show why
  if (res.status === 401 && path !== 'password-login') throw new Unauthorized();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join('; ')
      : data.message;
    throw new Error(message || `Ошибка ${res.status}`);
  }
  return data as T;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Settings {
  dailyQuestionLimit?: number | null;
  unlimitedUsernames?: string[] | null;
  dmUsernames?: string[] | null;
  actionUserIds?: number[] | null;
  alertChatIds?: number[] | null;
  aiEffort?: Effort | null;
}

export interface SettingsView {
  defaults: Required<{ [K in keyof Settings]: unknown }>;
  overrides: Settings;
  updatedAt: string | null;
}

export interface Usage {
  day: string;
  limit: number;
  questions: Array<{ userId: number; username: string | null; count: number }>;
  feedback: {
    answers: number;
    up: number;
    down: number;
    avgSeconds: number;
    avgInputTokens: number;
    avgCacheReadTokens: number;
    avgOutputTokens: number;
    disliked: Array<{ at: string; question: string; seconds: number }>;
  };
}

export const api = {
  login: (token: string) =>
    call<{ session: string }>('POST', 'login', { token }),
  passwordLogin: (email: string, password: string) =>
    call<{ session: string }>('POST', 'password-login', { email, password }),
  settings: () => call<SettingsView>('GET', 'settings'),
  save: (settings: Settings) =>
    call<SettingsView>('PUT', 'settings', { settings }),
  usage: () => call<Usage>('GET', 'usage'),
  logoutAll: () => call<{ ok: boolean }>('POST', 'logout-all'),
};
