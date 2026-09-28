import {
  McpOutcome,
  McpTask,
  McpTaskStatus,
} from '@domain/mcp-task/mcp-task.entity';

// How the task protocol is going, counted from the tasks themselves: is
// work getting solved, do IDEs report back, where do tasks get stuck.
// Only counts and one-line goals leave here, never history notes.

const HOUR = 3_600_000;
const STUCK_LIMIT = 10;

export interface McpStats {
  period: { days: number; from: string; to: string };
  tasks: {
    total: number;
    open: number;
    closed: number;
    byStatus: Record<McpTaskStatus, number>;
    waitingForReport: number;
    idleOverDay: number;
  };
  outcomes: {
    solved: number;
    escalated: number;
    abandoned: number;
    // Of the closed tasks, the share solved (null when none closed)
    solvedShare: number | null;
  };
  // Of the tasks that got an answer, the share the IDE reported on: the
  // measure of whether the protocol is followed
  reportedShare: number | null;
  rounds: {
    total: number;
    perTask: number | null;
    // Replies that asked for more material instead of answering
    needInfoShare: number | null;
    failedAttempts: number;
  };
  byClient: {
    client: string;
    total: number;
    open: number;
    solved: number;
    escalated: number;
    abandoned: number;
    waitingForReport: number;
  }[];
  // Open tasks nobody moved for the longest, oldest first
  stuck: {
    id: string;
    client: string;
    goal: string;
    status: McpTaskStatus;
    rounds: number;
    idleHours: number;
  }[];
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

const share = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 100) / 100 : null;

const hasReport = (t: McpTask) => t.history.some((e) => e.kind === 'report');
const hasAnswer = (t: McpTask) => t.history.some((e) => e.kind === 'answer');
const reported = (t: McpTask, outcome: McpOutcome) => t.status === outcome;

export const computeMcpStats = (
  tasks: McpTask[],
  now: Date,
  days: number,
): McpStats => {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
    McpTaskStatus,
    number
  >;
  tasks.forEach((t) => (byStatus[t.status] += 1));
  const open = tasks.filter((t) => t.isOpen);
  const closed = tasks.length - open.length;
  const answered = tasks.filter(hasAnswer);
  const replies = tasks.flatMap((t) =>
    t.history.filter((e) => e.kind !== 'report'),
  );
  const rounds = tasks.reduce((n, t) => n + t.rounds, 0);

  const clients = new Map<string, McpTask[]>();
  tasks.forEach((t) =>
    clients.set(t.owner, [...(clients.get(t.owner) ?? []), t]),
  );

  const idle = (t: McpTask) => now.getTime() - t.updatedAt.getTime();

  return {
    period: {
      days,
      from: new Date(now.getTime() - days * 24 * HOUR).toISOString(),
      to: now.toISOString(),
    },
    tasks: {
      total: tasks.length,
      open: open.length,
      closed,
      byStatus,
      waitingForReport: tasks.filter((t) => t.awaitingReport).length,
      idleOverDay: open.filter((t) => t.isStale(now)).length,
    },
    outcomes: {
      solved: byStatus.solved,
      escalated: byStatus.escalated,
      abandoned: byStatus.abandoned,
      solvedShare: share(byStatus.solved, closed),
    },
    reportedShare: share(answered.filter(hasReport).length, answered.length),
    rounds: {
      total: rounds,
      perTask: tasks.length
        ? Math.round((rounds / tasks.length) * 10) / 10
        : null,
      needInfoShare: share(
        replies.filter((e) => e.kind === 'need_info').length,
        replies.length,
      ),
      failedAttempts: tasks.reduce((n, t) => n + t.failures, 0),
    },
    byClient: [...clients.entries()]
      .map(([client, list]) => ({
        client,
        total: list.length,
        open: list.filter((t) => t.isOpen).length,
        solved: list.filter((t) => reported(t, 'solved')).length,
        escalated: list.filter((t) => t.status === 'escalated').length,
        abandoned: list.filter((t) => reported(t, 'abandoned')).length,
        waitingForReport: list.filter((t) => t.awaitingReport).length,
      }))
      .sort((a, b) => b.total - a.total || a.client.localeCompare(b.client)),
    stuck: open
      .sort((a, b) => idle(b) - idle(a))
      .slice(0, STUCK_LIMIT)
      .map((t) => ({
        id: t.id,
        client: t.owner,
        goal: t.goal,
        status: t.status,
        rounds: t.rounds,
        idleHours: Math.floor(idle(t) / HOUR),
      })),
  };
};
