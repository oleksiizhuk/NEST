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

export type ReviewKind = 'meeting' | 'standup' | 'retro' | 'oneonone';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Settings {
  dailyQuestionLimit?: number | null;
  unlimitedUsernames?: string[] | null;
  dmUsernames?: string[] | null;
  actionUserIds?: number[] | null;
  alertChatIds?: number[] | null;
  aiEffort?: Effort | null;
  pmInOwnerGroups?: boolean | null;
  teamThresholds?: Thresholds | null;
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

export type SignalRule =
  | 'wip'
  | 'stale'
  | 'off-release'
  | 'priority'
  | 'overdue'
  | 'blocked'
  | 'idle'
  | 'no-output'
  | 'pr-wait'
  | 'changes'
  | 'away'
  | 'handover'
  | 'overload'
  | 'underload'
  | 'runway'
  | 'ok';

export interface Signal {
  level: 'warn' | 'info' | 'ok';
  rule: SignalRule;
  text: string;
  why?: string;
  keys: string[];
  say?: string;
}

export interface Thresholds {
  wipLimit: number;
  staleDays: number;
  reviewWaitDays: number;
  runwayDays: number;
  off: SignalRule[];
}

export interface Links {
  jira: string | null;
  githubOrg: string | null;
}

export interface TodayItem extends Signal {
  id: string;
  person: string;
  inRelease: boolean;
}

export interface TodayView {
  asOf: string | null;
  links: Links | null;
  releaseVersion?: string | null;
  items: TodayItem[];
  more: number;
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
  away: { until: string; note: string | null } | null;
  load: {
    total: number;
    median: number;
    ratio: number | null;
    badge: 'over' | 'under' | 'normal' | null;
    pace: number | null;
    runwayDays: number | null;
    weekly: number[] | null;
  };
  signals: Signal[];
}

export interface WeeklyFlow {
  weeks: string[];
  done: number[];
  created: number[];
  capped: boolean;
}

export interface TeamView {
  team: {
    asOf: string;
    releaseVersion: string | null;
    capped: boolean;
    people: Person[];
    unmatchedGithub: string[];
    hasDetails: boolean;
    thresholds: Thresholds;
    links: Links;
    telegram: Record<string, string>;
    flow: WeeklyFlow | null;
    scopeGrowing: boolean;
    unassigned: Array<{
      key: string;
      summary: string;
      priority: string | null;
      inScope: boolean;
    }>;
  } | null;
  review: { text: string; at: string } | null;
}

export type Stage = 'todo' | 'dev' | 'review' | 'qa' | 'blocked' | 'done';

export interface FlowView {
  asOf: string;
  links: Links;
  stages: {
    windowDays: number;
    finished: number;
    stageMedians: Record<'dev' | 'review' | 'qa' | 'blocked', number | null>;
    cycle: { p50: number | null; p85: number | null };
    aging: Array<{
      key: string;
      assignee: string | null;
      status: string;
      stage: Stage;
      ageDays: number;
      stageDays: number;
      overP85: boolean;
    }>;
    bounces: {
      count: number;
      total: number;
      from: Partial<Record<Stage, number>>;
      reopened: number;
      worst: Array<{ key: string; times: number; assignee: string | null }>;
    };
    handoffs: {
      pairs: Array<{
        from: string;
        to: string;
        count: number;
        waitDays: number | null;
      }>;
      many: Array<{ key: string; people: number }>;
    };
    blocked: {
      daysInWindow: number;
      current: Array<{ key: string; assignee: string | null; days: number }>;
    };
    statuses: Array<{
      name: string;
      stage: Stage;
      source: 'map' | 'name' | 'category';
    }>;
  } | null;
}

export interface ReleaseData {
  version: string;
  releaseDate: string | null;
  workingDaysLeft: number | null;
  capped: boolean;
  scope: { total: number; done: number; open: number; inProgress: number };
  burnup: Array<{ day: string; scope: number; done: number }>;
  pace: { perDay: number | null; best: number | null; worst: number | null };
  eta: {
    date: string | null;
    early: string | null;
    late: string | null;
    daysLate: number | null;
    verdict: 'on-track' | 'at-risk' | 'late' | 'unknown';
  };
  creep: {
    baseline: string;
    atBaseline: number;
    added: Array<{
      key: string;
      summary: string;
      type: string;
      priority: string | null;
      reporter: string | null;
      at: string;
      done: boolean;
    }>;
    addedLast7: number;
    percent: number | null;
    custom: boolean;
  };
  critical: Array<{
    key: string;
    summary: string;
    assignee: string | null;
    priority: string | null;
    waiting: number;
    blockedBy: string[];
  }>;
  people: Array<{
    name: string;
    open: number;
    share: number;
    pace: number | null;
    daysNeeded: number | null;
    risk: boolean;
  }>;
  mismatches: Array<{
    key: string;
    kind: 'merged-not-done' | 'progress-no-pr' | 'done-no-pr';
    detail: string;
  }>;
  open: Array<{
    key: string;
    priority: string | null;
    assignee: string | null;
  }>;
}

export interface ReleaseView {
  asOf: string;
  links: Links;
  hasCode: boolean;
  releaseError: string | null;
  release: ReleaseData | null;
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
  teamReview: (force: boolean, kind: ReviewKind = 'meeting', person?: string) =>
    call<{ text: string; at: string }>('POST', 'team/review', {
      force,
      kind,
      person,
    }),
  reviewLatest: (kind: ReviewKind, person?: string) =>
    call<{ text: string; at: string } | null>('POST', 'team/review/latest', {
      kind,
      person,
    }),
  setTelegram: (name: string, username: string | null) =>
    call<TeamView>('PUT', 'team/telegram', { name, username }),
  nudge: (name: string, text: string, chatId: number) =>
    call<{ sent: boolean; mention: boolean }>('POST', 'team/nudge', {
      name,
      text,
      chatId,
    }),
  setGithub: (name: string, login: string | null) =>
    call<TeamView>('PUT', 'team/github', { name, login }),
  setAway: (name: string, until: string | null, note: string | null) =>
    call<TeamView>('PUT', 'team/away', { name, until, note }),
  today: () => call<TodayView>('GET', 'today'),
  flow: () => call<FlowView | null>('GET', 'flow'),
  release: () => call<ReleaseView | null>('GET', 'release'),
  setBaseline: (date: string | null) =>
    call<ReleaseView | null>('PUT', 'release/baseline', { date }),
  hideToday: (id: string, days: 1 | 7) =>
    call<TodayView>('POST', 'today/hide', { id, days }),
  setChat: (chatId: number, on: boolean | 'auto') =>
    call<Chat[]>('PUT', 'chats', { chatId, on }),
  setChatAlerts: (chatId: number, alerts: boolean) =>
    call<Chat[]>('PUT', 'chats', { chatId, alerts }),
};
