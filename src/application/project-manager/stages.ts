import { workingDaysBetween } from '@application/project-manager/release-clock';
import { median } from '@application/project-manager/load';

// Where work waits: each ticket's status history turned into stages
// (dev → review → QA → done), counted at refresh from the Jira changelog.
// Workflows differ, so a status name maps to a stage by PM_STATUS_MAP, then
// by common words in the name, then by its Jira status category.

export type Stage = 'todo' | 'dev' | 'review' | 'qa' | 'blocked' | 'done';
export const STAGES: Stage[] = [
  'todo',
  'dev',
  'review',
  'qa',
  'blocked',
  'done',
];
const ORDER: Partial<Record<Stage, number>> = {
  todo: 0,
  dev: 1,
  review: 2,
  qa: 3,
  done: 4,
};

export const FLOW_WINDOW_DAYS = 30;

export interface IssueHistory {
  key: string;
  assignee: string | null;
  created: string | null;
  status: string;
  category: 'new' | 'indeterminate' | 'done';
  doneAt: string | null;
  statusChanges: Array<{ at: string; from: string; to: string }>;
  assigneeChanges: Array<{
    at: string;
    from: string | null;
    to: string | null;
  }>;
}

// "In Review=review, QA=qa, On hold=blocked"
export const parseStatusMap = (
  raw: string | undefined,
): Record<string, Stage> => {
  const map: Record<string, Stage> = {};
  for (const part of (raw ?? '').split(',')) {
    const [name, stage] = part.split('=').map((v) => v?.trim());
    if (name && STAGES.includes(stage as Stage))
      map[name.toLowerCase()] = stage as Stage;
  }
  return map;
};

const BY_NAME: Array<[RegExp, Stage]> = [
  [/block|on hold|hold|waiting for|блок|ожида/i, 'blocked'],
  [/review|ревью|pull request|\bpr\b|code check/i, 'review'],
  [/\bqa\b|test|testing|verif|тест|провер/i, 'qa'],
  // Names seen only in history have no known category
  [/done|closed|resolved|released|готов|закрыт|выполн/i, 'done'],
  [
    /to ?do|backlog|\bopen\b|\bnew\b|selected|ready for dev|сделать|бэклог|нов/i,
    'todo',
  ],
];

export type StageSource = 'map' | 'name' | 'category';

export const stageFor = (
  status: string,
  category: IssueHistory['category'] | undefined,
  map: Record<string, Stage>,
): { stage: Stage; source: StageSource } => {
  const mapped = map[status.toLowerCase()];
  if (mapped) return { stage: mapped, source: 'map' };
  if (category === 'done') return { stage: 'done', source: 'category' };
  const named = BY_NAME.find(([re]) => re.test(status));
  if (named) return { stage: named[1], source: 'name' };
  return {
    stage:
      category === 'indeterminate'
        ? 'dev'
        : category === 'new'
        ? 'todo'
        : 'dev',
    source: 'category',
  };
};

export interface FlowStages {
  windowDays: number;
  // Finished tickets in the window the numbers below come from
  finished: number;
  // Median working days a finished ticket spent in each stage it visited
  stageMedians: Record<'dev' | 'review' | 'qa' | 'blocked', number | null>;
  // Working days from first start to done
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
    // Backward moves out of each stage (e.g. qa: 4 = sent back from QA)
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
  // Every status seen and the stage it counts as, so the owner can check
  statuses: Array<{ name: string; stage: Stage; source: StageSource }>;
  // Last status change per open ticket: the real "days in status"
  lastChange: Record<string, string>;
}

const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
};

const days = (from: string, to: Date) => workingDaysBetween(new Date(from), to);

export const flowStages = (
  issues: IssueHistory[],
  map: Record<string, Stage>,
  now: Date,
): FlowStages => {
  const windowStart = new Date(now.getTime() - FLOW_WINDOW_DAYS * 86_400_000);
  const seen = new Map<string, { stage: Stage; source: StageSource }>();
  const stage = (status: string, category?: IssueHistory['category']) => {
    const s = stageFor(status, category, map);
    if (!seen.has(status)) seen.set(status, s);
    return s.stage;
  };
  // Categories of names we know from the current lists
  const categoryOf = new Map<string, IssueHistory['category']>();
  for (const i of issues) categoryOf.set(i.status, i.category);
  const stageOfName = (name: string) => stage(name, categoryOf.get(name));

  const perStage: Record<'dev' | 'review' | 'qa' | 'blocked', number[]> = {
    dev: [],
    review: [],
    qa: [],
    blocked: [],
  };
  const cycles: number[] = [];
  const bounceFrom: Partial<Record<Stage, number>> = {};
  const worst: FlowStages['bounces']['worst'] = [];
  let bounced = 0;
  let reopened = 0;
  let blockedDays = 0;
  const pairs = new Map<string, { count: number; waits: number[] }>();
  const many: FlowStages['handoffs']['many'] = [];
  const lastChange: Record<string, string> = {};
  const open: Array<{
    i: IssueHistory;
    firstStart: string | null;
    since: string;
  }> = [];
  let finished = 0;

  for (const i of issues) {
    const changes = [...i.statusChanges].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
    const current = stage(i.status, i.category);
    // Segments: [start, end) in one status
    const segments: Array<{ status: string; from: string; to: string | null }> =
      [];
    let status = changes[0]?.from ?? i.status;
    let at = i.created ?? changes[0]?.at ?? now.toISOString();
    for (const c of changes) {
      segments.push({ status, from: at, to: c.at });
      status = c.to;
      at = c.at;
    }
    segments.push({ status, from: at, to: null });
    if (changes.length) lastChange[i.key] = changes[changes.length - 1].at;

    const firstStart =
      segments.find((s) => !['todo', 'done'].includes(stageOfName(s.status)))
        ?.from ?? null;

    // Backward moves between ordered stages; done → anything is a reopen
    let times = 0;
    for (const c of changes) {
      const a = stageOfName(c.from);
      const b = stageOfName(c.to);
      if (a === 'done' && b !== 'done') reopened += 1;
      const oa = ORDER[a];
      const ob = ORDER[b];
      if (oa !== undefined && ob !== undefined && ob < oa) {
        times += 1;
        bounceFrom[a] = (bounceFrom[a] ?? 0) + 1;
      }
    }
    if (times) {
      bounced += 1;
      worst.push({ key: i.key, times, assignee: i.assignee });
    }

    // Blocked time inside the window
    for (const s of segments) {
      if (stageOfName(s.status) !== 'blocked') continue;
      const from = new Date(
        Math.max(new Date(s.from).getTime(), windowStart.getTime()),
      );
      const to = s.to ? new Date(s.to) : now;
      if (to > from) blockedDays += workingDaysBetween(from, to);
    }

    // Who passed it to whom, and how long until the status moved after
    const people = new Set<string>();
    if (i.assignee) people.add(i.assignee);
    for (const a of i.assigneeChanges) {
      if (a.from) people.add(a.from);
      if (a.to) people.add(a.to);
      if (!a.from || !a.to || a.from === a.to) continue;
      const next = changes.find((c) => c.at > a.at);
      const entry = pairs.get(`${a.from}→${a.to}`) ?? { count: 0, waits: [] };
      entry.count += 1;
      if (next) entry.waits.push(days(a.at, new Date(next.at)));
      pairs.set(`${a.from}→${a.to}`, entry);
    }
    if (people.size >= 3) many.push({ key: i.key, people: people.size });

    if (i.category === 'done') {
      if (!i.doneAt || new Date(i.doneAt) < windowStart) continue;
      finished += 1;
      const spent: Partial<Record<Stage, number>> = {};
      for (const s of segments) {
        const st = stageOfName(s.status);
        if (st === 'todo' || st === 'done') continue;
        spent[st] =
          (spent[st] ?? 0) + days(s.from, s.to ? new Date(s.to) : now);
      }
      for (const k of Object.keys(perStage) as Array<keyof typeof perStage>)
        if (spent[k] !== undefined) perStage[k].push(spent[k] as number);
      if (firstStart) cycles.push(days(firstStart, new Date(i.doneAt)));
    } else if (current !== 'todo') {
      open.push({ i, firstStart, since: lastChange[i.key] ?? at });
    }
  }

  const p85 = percentile(cycles, 85);
  const aging = open
    .map(({ i, firstStart, since }) => {
      const ageDays = firstStart ? days(firstStart, now) : days(since, now);
      return {
        key: i.key,
        assignee: i.assignee,
        status: i.status,
        stage: stage(i.status, i.category),
        ageDays,
        stageDays: days(since, now),
        overP85: p85 !== null && ageDays > p85,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 40);

  return {
    windowDays: FLOW_WINDOW_DAYS,
    finished,
    stageMedians: {
      dev: perStage.dev.length ? median(perStage.dev) : null,
      review: perStage.review.length ? median(perStage.review) : null,
      qa: perStage.qa.length ? median(perStage.qa) : null,
      blocked: perStage.blocked.length ? median(perStage.blocked) : null,
    },
    cycle: { p50: percentile(cycles, 50), p85 },
    aging,
    bounces: {
      count: bounced,
      total: issues.length,
      from: bounceFrom,
      reopened,
      worst: worst.sort((a, b) => b.times - a.times).slice(0, 10),
    },
    handoffs: {
      pairs: [...pairs.entries()]
        .map(([k, v]) => {
          const [from, to] = k.split('→');
          return {
            from,
            to,
            count: v.count,
            waitDays: v.waits.length ? median(v.waits) : null,
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      many: many.sort((a, b) => b.people - a.people).slice(0, 10),
    },
    blocked: {
      daysInWindow: blockedDays,
      current: open
        .filter(({ i }) => stage(i.status, i.category) === 'blocked')
        .map(({ i, since }) => ({
          key: i.key,
          assignee: i.assignee,
          days: days(since, now),
        }))
        .sort((a, b) => b.days - a.days)
        .slice(0, 15),
    },
    statuses: [...seen.entries()]
      .map(([name, s]) => ({ name, ...s }))
      .sort(
        (a, b) =>
          STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) ||
          a.name.localeCompare(b.name),
      ),
    lastChange,
  };
};
