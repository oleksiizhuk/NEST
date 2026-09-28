import { McpTask, McpTaskStatus } from '@domain/mcp-task/mcp-task.entity';

// How the task protocol is going, counted from the tasks themselves: is
// work getting solved, do IDEs gather first and report back, which client
// breaks the protocol, what hangs. Only counts and short goals leave here.

const HOUR = 3_600_000;
const STUCK_LIMIT = 10;
const GOAL_CHARS = 120;

export const DEFAULT_STATS_DAYS = 7;
// Tasks live 30 days after their last call; a window beyond that only
// catches tasks still being touched, so 30 is where it stops being useful
export const MAX_STATS_DAYS = 30;

// ?days=: anything unreadable is the default, the rest is kept in range
export const clampStatsDays = (days?: number): number => {
  if (days === undefined || !Number.isFinite(days)) return DEFAULT_STATS_DAYS;
  return Math.min(MAX_STATS_DAYS, Math.max(1, Math.floor(days)));
};

export const statsSince = (now: Date, days: number) =>
  new Date(now.getTime() - days * 24 * HOUR);

type Share = number | null;

interface Discipline {
  // Started with a bare ask_advice instead of start_task (tasks where it is
  // known; older tasks do not say)
  skippedStart: number;
  skippedStartShare: Share;
  // Of the tasks that got an answer, the share reported on. An answer
  // under a day old is still in play and not counted either way.
  reportedShare: Share;
  // Still open and nobody touched them for over a day
  silentlyDropped: number;
}

export interface McpStats {
  period: { days: number; from: string; to: string };
  // Tasks started in the period
  started: {
    total: number;
    byStatus: Record<McpTaskStatus, number>;
  } & Discipline;
  outcomes: {
    solved: number;
    escalated: number;
    abandoned: number;
    silentlyDropped: number;
    // Solved of everything that ended, dropped silently included
    solvedShare: Share;
  };
  rounds: {
    total: number;
    perTask: number | null;
    // Replies that asked for more material instead of answering
    needInfoShare: Share;
    failedAttempts: number;
  };
  byClient: ({
    client: string;
    total: number;
    solved: number;
    escalated: number;
    abandoned: number;
    rounds: number;
    failedAttempts: number;
  } & Discipline)[];
  // Every open task, whenever it started
  open: {
    total: number;
    waitingForReport: number;
    idleOverDay: number;
    // Open and untouched for over a day, the longest idle first
    stuck: {
      id: string;
      client: string;
      goal: string;
      status: McpTaskStatus;
      rounds: number;
      idleHours: number;
    }[];
  };
}

const STATUSES: McpTaskStatus[] = [
  'gathering',
  'answered',
  'not_solved',
  'partial',
  'solved',
  'escalated',
  'abandoned',
];

const share = (part: number, whole: number): Share =>
  whole ? Math.round((part / whole) * 100) / 100 : null;

const has = (t: McpTask, kind: 'answer' | 'report') =>
  t.history.some((e) => e.kind === kind);

const count = (tasks: McpTask[], test: (t: McpTask) => boolean) =>
  tasks.filter(test).length;

const discipline = (tasks: McpTask[], now: Date): Discipline => {
  const known = tasks.filter((t) => t.startedVia !== null);
  const skipped = count(known, (t) => t.startedVia === 'ask_advice');
  const answered = tasks.filter(
    (t) => has(t, 'answer') && !(t.awaitingReport && !t.isStale(now)),
  );
  return {
    skippedStart: skipped,
    skippedStartShare: share(skipped, known.length),
    reportedShare: share(
      count(answered, (t) => has(t, 'report')),
      answered.length,
    ),
    silentlyDropped: count(tasks, (t) => t.isStale(now)),
  };
};

const shortGoal = (goal: string) =>
  goal.length > GOAL_CHARS ? `${goal.slice(0, GOAL_CHARS - 1)}…` : goal;

export const computeMcpStats = (input: {
  // Tasks started in the period
  started: McpTask[];
  // Open tasks of any age
  open: McpTask[];
  now: Date;
  // The period's start, as the tasks were read from it
  since: Date;
  days: number;
}): McpStats => {
  const { started, open, now, since, days } = input;
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    McpTaskStatus,
    number
  >;
  started.forEach((t) => (byStatus[t.status] += 1));
  const closed = count(started, (t) => !t.isOpen);
  const own = discipline(started, now);
  const replies = started.flatMap((t) =>
    t.history.filter((e) => e.kind !== 'report'),
  );
  const rounds = started.reduce((n, t) => n + t.rounds, 0);
  const idle = (t: McpTask) => now.getTime() - t.updatedAt.getTime();

  const clients = new Map<string, McpTask[]>();
  started.forEach((t) =>
    clients.set(t.owner, [...(clients.get(t.owner) ?? []), t]),
  );

  return {
    period: {
      days,
      from: since.toISOString(),
      to: now.toISOString(),
    },
    started: { total: started.length, byStatus, ...own },
    outcomes: {
      solved: byStatus.solved,
      escalated: byStatus.escalated,
      abandoned: byStatus.abandoned,
      silentlyDropped: own.silentlyDropped,
      solvedShare: share(byStatus.solved, closed + own.silentlyDropped),
    },
    rounds: {
      total: rounds,
      perTask: started.length
        ? Math.round((rounds / started.length) * 10) / 10
        : null,
      needInfoShare: share(
        replies.filter((e) => e.kind === 'need_info').length,
        replies.length,
      ),
      failedAttempts: started.reduce((n, t) => n + t.failures, 0),
    },
    byClient: [...clients.entries()]
      .map(([client, list]) => ({
        client,
        total: list.length,
        solved: count(list, (t) => t.status === 'solved'),
        escalated: count(list, (t) => t.status === 'escalated'),
        abandoned: count(list, (t) => t.status === 'abandoned'),
        rounds: list.reduce((n, t) => n + t.rounds, 0),
        failedAttempts: list.reduce((n, t) => n + t.failures, 0),
        ...discipline(list, now),
      }))
      .sort((a, b) => b.total - a.total || a.client.localeCompare(b.client)),
    open: {
      total: open.length,
      waitingForReport: count(open, (t) => t.awaitingReport),
      idleOverDay: count(open, (t) => t.isStale(now)),
      stuck: open
        .filter((t) => t.isStale(now))
        .sort((a, b) => idle(b) - idle(a))
        .slice(0, STUCK_LIMIT)
        .map((t) => ({
          id: t.id,
          client: t.owner,
          goal: shortGoal(t.goal),
          status: t.status,
          rounds: t.rounds,
          idleHours: Math.floor(idle(t) / HOUR),
        })),
    },
  };
};
