import {
  workingDaysBetween,
  workingDaysLeft,
} from '@application/project-manager/release-clock';
import { pacePerDay, WeeklyFlow } from '@application/project-manager/load';
import { TeamCode } from '@application/project-manager/team';

// The Релиз page: will the release land on its date, what grew, what the
// rest waits on. Counted in code from the release version's tickets (all
// statuses) that the Jira reader keeps at refresh; no model call.

export interface ReleaseIssue {
  key: string;
  summary: string;
  type: string;
  status: string;
  category: 'new' | 'indeterminate' | 'done';
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  created: string | null;
  doneAt: string | null;
  statusSince: string | null;
  blockedBy: string[];
  // When the version was last put on the ticket (changelog), else created
  addedAt: string | null;
  // dev / review / qa / blocked… by the reader's status mapping
  stage?: string | null;
}

export interface ReleaseIssues {
  version: string;
  capped: boolean;
  issues: ReleaseIssue[];
  // The release could not be read at the last refresh
  error?: string | null;
}

type Verdict = 'on-track' | 'at-risk' | 'late' | 'unknown';

export interface ReleaseView {
  version: string;
  releaseDate: string | null;
  workingDaysLeft: number | null;
  capped: boolean;
  scope: { total: number; done: number; open: number; inProgress: number };
  burnup: Array<{ day: string; scope: number; done: number }>;
  // Release tickets closed per working day (last two weeks) and the best
  // and worst full week of the last four
  pace: { perDay: number | null; best: number | null; worst: number | null };
  eta: {
    date: string | null;
    early: string | null;
    late: string | null;
    daysLate: number | null;
    verdict: Verdict;
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
    // The owner fixed the baseline; otherwise it rolls with "30 days ago"
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
  // Open release work for the page's what-if, smallest shape
  open: Array<{
    key: string;
    priority: string | null;
    assignee: string | null;
  }>;
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

// The date `n` working days after `from`
export const addWorkingDays = (from: Date, n: number): Date => {
  const day = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  let left = Math.ceil(n);
  while (left > 0) {
    day.setUTCDate(day.getUTCDate() + 1);
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return day;
};

export const releaseView = (
  data: ReleaseIssues,
  now: Date,
  options: {
    releaseDate: string | null;
    baseline?: string | null;
    code?: TeamCode | null;
    flow?: WeeklyFlow | null;
  },
): ReleaseView => {
  const issues = data.issues;
  const open = issues.filter((i) => i.category !== 'done');
  const done = issues.filter((i) => i.category === 'done');
  const today = iso(now);
  const daysLeft = options.releaseDate
    ? workingDaysLeft(now, options.releaseDate)
    : null;

  // A ticket tagged into the release after it was closed shows as done on
  // the burn-up from the day it was added, but is not release pace: that
  // work was done before it belonged to the release
  const time = (v: string | null) => (v ? Date.parse(v) : NaN);
  const addedMs = (i: ReleaseIssue) => time(i.addedAt ?? i.created);
  const closedMs = (i: ReleaseIssue) => {
    const doneAt = time(i.doneAt);
    const added = addedMs(i);
    if (!Number.isFinite(doneAt)) return added;
    return Number.isFinite(added) ? Math.max(doneAt, added) : doneAt;
  };
  const taggedAfterClose = (i: ReleaseIssue) => time(i.doneAt) < addedMs(i);
  const endOf = (day: string) => Date.parse(`${day}T23:59:59.999Z`);

  // Burn-up: 30 days, one point a day (UTC days)
  const burnup: ReleaseView['burnup'] = [];
  for (let n = 29; n >= 0; n -= 1) {
    const day = iso(new Date(now.getTime() - n * DAY));
    const end = endOf(day);
    burnup.push({
      day,
      scope: issues.filter((i) => !(addedMs(i) > end)).length,
      done: done.filter((i) => closedMs(i) <= end).length,
    });
  }

  // Pace of release work in blocks of 5 working days back from today: the
  // last two blocks give the forecast, the best and worst of four the range
  const blocks = [0, 0, 0, 0];
  for (const i of done) {
    if (taggedAfterClose(i)) continue;
    const at = time(i.doneAt);
    if (!Number.isFinite(at) || at > now.getTime()) continue;
    const ago = workingDaysBetween(new Date(at), now);
    if (ago < 20) blocks[Math.floor(ago / 5)] += 1;
  }
  const perDay = (blocks[0] + blocks[1]) / 10 || null;
  const weekly = blocks.map((n) => n / 5);
  const best = Math.max(...weekly) || null;
  const worst = Math.min(...weekly) || null;

  const remaining = open.length;
  const closes = done.map(closedMs).filter(Number.isFinite);
  const finishedAt = closes.length ? iso(new Date(Math.max(...closes))) : today;
  const etaAt = (pace: number | null) =>
    remaining === 0
      ? finishedAt
      : pace
      ? iso(addWorkingDays(now, remaining / pace))
      : null;
  const eta = etaAt(perDay);
  const early = eta ? etaAt(best) : null;
  const late = eta ? etaAt(worst) : null;
  let verdict: Verdict = 'unknown';
  let daysLate: number | null = null;
  if (options.releaseDate) {
    if (!eta) verdict = 'late';
    else if (eta <= options.releaseDate) verdict = 'on-track';
    else if (early && early <= options.releaseDate) verdict = 'at-risk';
    else verdict = 'late';
    if (eta)
      daysLate =
        eta > options.releaseDate
          ? workingDaysBetween(
              new Date(`${options.releaseDate}T00:00:00Z`),
              new Date(`${eta}T00:00:00Z`),
            )
          : 0;
  }

  // Scope creep against a baseline day (owner's, else 30 days ago)
  // A real day only; anything else stored earlier falls back
  const custom = Boolean(
    options.baseline &&
      /^\d{4}-\d{2}-\d{2}$/.test(options.baseline) &&
      !isNaN(Date.parse(`${options.baseline}T00:00:00Z`)) &&
      new Date(`${options.baseline}T00:00:00Z`).toISOString().slice(0, 10) ===
        options.baseline,
  );
  const baseline = custom
    ? (options.baseline as string)
    : iso(new Date(now.getTime() - 29 * DAY));
  const atBaseline = issues.filter(
    (i) => !(addedMs(i) > endOf(baseline)),
  ).length;
  const added = issues
    .filter((i) => addedMs(i) > endOf(baseline))
    .map((i) => ({
      key: i.key,
      summary: i.summary,
      type: i.type,
      priority: i.priority,
      reporter: i.reporter,
      at: new Date(addedMs(i)).toISOString(),
      done: i.category === 'done',
    }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const weekAgo = now.getTime() - 7 * DAY;
  const addedLast7 = added.filter((a) => Date.parse(a.at) > weekAgo).length;

  // What the rest waits on: open release tickets others are blocked by
  const openKeys = new Set(open.map((i) => i.key));
  const waiting = new Map<string, number>();
  for (const i of open)
    for (const b of i.blockedBy)
      if (openKeys.has(b)) waiting.set(b, (waiting.get(b) ?? 0) + 1);
  const critical = open
    .filter((i) => waiting.has(i.key) || i.blockedBy.length)
    .map((i) => ({
      key: i.key,
      summary: i.summary,
      assignee: i.assignee,
      priority: i.priority,
      waiting: waiting.get(i.key) ?? 0,
      blockedBy: i.blockedBy,
    }))
    .sort((a, b) => b.waiting - a.waiting || a.key.localeCompare(b.key))
    .slice(0, 15);

  // Who holds the remaining release work, and can they finish it in time
  const holders = new Map<string, number>();
  for (const i of open)
    if (i.assignee) holders.set(i.assignee, (holders.get(i.assignee) ?? 0) + 1);
  const people = [...holders.entries()]
    .map(([name, n]) => {
      const pace = options.flow ? pacePerDay(options.flow.people[name]) : null;
      const daysNeeded = pace ? n / pace : null;
      const share = remaining ? n / remaining : 0;
      return {
        name,
        open: n,
        share: Math.round(share * 100) / 100,
        pace: pace === null ? null : Math.round(pace * 100) / 100,
        daysNeeded:
          daysNeeded === null ? null : Math.round(daysNeeded * 10) / 10,
        risk:
          share > 0.4 ||
          (daysLeft !== null && daysNeeded !== null && daysNeeded > daysLeft),
      };
    })
    .sort((a, b) => b.open - a.open);

  // Jira vs code, by ticket keys in PR titles
  const mismatches: ReleaseView['mismatches'] = [];
  const code = options.code;
  if (code) {
    const inOpen = new Map<string, string>();
    const inMerged = new Map<string, string>();
    for (const a of Object.values(code.authors ?? {})) {
      for (const pr of a.open ?? [])
        for (const k of pr.title.match(KEY) ?? [])
          inOpen.set(k, `${pr.repo}#${pr.number}`);
      for (const m of a.merged14 ?? [])
        for (const k of m.match(KEY) ?? []) inMerged.set(k, m.split(' ')[0]);
    }
    for (const i of open) {
      const merged = inMerged.get(i.key);
      // After a merge, review and QA are the normal next steps
      if (
        merged &&
        !inOpen.has(i.key) &&
        !['review', 'qa'].includes(i.stage ?? '')
      ) {
        mismatches.push({
          key: i.key,
          kind: 'merged-not-done',
          detail: `PR ${merged} смёржен, а задача в «${i.status}»`,
        });
        continue;
      }
      const days = i.statusSince
        ? workingDaysBetween(new Date(i.statusSince), now)
        : 0;
      if (
        i.category === 'indeterminate' &&
        days > 3 &&
        !inOpen.has(i.key) &&
        !merged
      )
        mismatches.push({
          key: i.key,
          kind: 'progress-no-pr',
          detail: `в «${i.status}» ${days} раб. дн., PR с ${i.key} в названии не видно`,
        });
    }
    const since = now.getTime() - 14 * DAY;
    for (const i of done) {
      if (!i.doneAt || new Date(i.doneAt).getTime() < since) continue;
      if (
        /bug|story|task|задач|ошибк/i.test(i.type) &&
        !inMerged.has(i.key) &&
        !inOpen.has(i.key)
      )
        mismatches.push({
          key: i.key,
          kind: 'done-no-pr',
          detail: 'закрыта, PR с этим ключом в названии не видно за 14 дней',
        });
    }
  }

  return {
    version: data.version,
    releaseDate: options.releaseDate,
    workingDaysLeft: daysLeft,
    capped: data.capped,
    scope: {
      total: issues.length,
      done: done.length,
      open: open.length,
      inProgress: open.filter((i) => i.category === 'indeterminate').length,
    },
    burnup,
    // Unrounded: the page's what-if must land on the same date
    pace: { perDay, best, worst },
    eta: { date: eta, early, late, daysLate, verdict },
    creep: {
      baseline,
      atBaseline,
      added,
      addedLast7,
      custom,
      percent: atBaseline
        ? Math.round((added.length / atBaseline) * 100)
        : null,
    },
    critical,
    people,
    mismatches: mismatches.slice(0, 30),
    open: open.map((i) => ({
      key: i.key,
      priority: i.priority,
      assignee: i.assignee,
    })),
  };
};
