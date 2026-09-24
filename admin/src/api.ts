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
  if (res.status === 401 && !path.startsWith('password-login'))
    throw new Unauthorized();
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
  pmInOwnerGroups?: boolean | null;
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

export interface Chat {
  chatId: number;
  title: string | null;
  lastAt: string;
  on: boolean;
  fixed: boolean;
  mode: 'fixed' | 'on' | 'off' | 'auto' | 'none' | 'unknown';
  digest: boolean;
  alerts: boolean;
}

export interface TeamIssue {
  key: string;
  summary: string;
  status: string;
  priority: string | null;
  inScope: boolean;
  due: string | null;
  blocked: boolean;
  days?: number | null;
}

export interface Person {
  name: string;
  github: string | null;
  inProgress: TeamIssue[];
  queue: TeamIssue[];
  done14: Array<{ key: string; summary: string; doneAt: string | null }>;
  pulls: Array<{
    repo: string;
    number: number;
    title: string;
    waitingDays: number;
    review: string;
    draft: boolean;
  }>;
  merged14: string[];
  signals: Array<{ level: 'warn' | 'info' | 'ok'; text: string }>;
}

export interface TeamView {
  team: {
    asOf: string;
    releaseVersion: string | null;
    capped: boolean;
    people: Person[];
    unmatchedGithub: string[];
    hasDetails: boolean;
  } | null;
  review: { text: string; at: string } | null;
}

export type IndexSource = 'jira' | 'confluence' | 'figma' | 'github';

export interface IndexJob {
  runId: string;
  status: 'running' | 'done' | 'failed';
  stage: IndexSource | 'done';
  counts: Partial<Record<IndexSource, number>>;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface IndexStatus {
  job: IndexJob | null;
  counts: Partial<Record<IndexSource, number>>;
  sources: IndexSource[];
}

export const api = {
  login: (token: string) =>
    call<{ session: string }>('POST', 'login', { token }),
  passwordLogin: (email: string, password: string) =>
    call<{ pending: string; seconds: number }>('POST', 'password-login', {
      email,
      password,
    }),
  passwordLoginStatus: (id: string) =>
    call<{ session?: string; pending?: boolean }>(
      'POST',
      'password-login/status',
      { id },
    ),
  settings: () => call<SettingsView>('GET', 'settings'),
  save: (settings: Settings) =>
    call<SettingsView>('PUT', 'settings', { settings }),
  usage: () => call<Usage>('GET', 'usage'),
  logoutAll: () => call<{ ok: boolean }>('POST', 'logout-all'),
  chats: () => call<Chat[]>('GET', 'chats'),
  team: () => call<TeamView>('GET', 'team'),
  indexStatus: () => call<IndexStatus>('GET', 'index'),
  indexStart: () => call<IndexJob>('POST', 'index/start'),
  indexStep: () => call<IndexJob>('POST', 'index/step'),
  refreshData: () =>
    call<{
      at: string;
      sources: Array<{ source: string; ok: boolean; error: string | null }>;
    }>('POST', 'refresh'),
  teamReview: (force: boolean) =>
    call<{ text: string; at: string }>('POST', 'team/review', { force }),
  setGithub: (name: string, login: string | null) =>
    call<TeamView>('PUT', 'team/github', { name, login }),
  setChat: (chatId: number, on: boolean | 'auto') =>
    call<Chat[]>('PUT', 'chats', { chatId, on }),
  setChatAlerts: (chatId: number, alerts: boolean) =>
    call<Chat[]>('PUT', 'chats', { chatId, alerts }),
};
