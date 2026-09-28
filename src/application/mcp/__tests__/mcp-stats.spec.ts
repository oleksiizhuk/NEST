import { clampStatsDays, computeMcpStats } from '@application/mcp/mcp-stats';
import {
  McpStartedVia,
  McpTask,
  McpTaskEvent,
  McpTaskStatus,
} from '@domain/mcp-task/mcp-task.entity';

const now = new Date('2026-09-28T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const answer: McpTaskEvent = { at: now, kind: 'answer', note: '' };
const needInfo: McpTaskEvent = { at: now, kind: 'need_info', note: '' };
const report: McpTaskEvent = {
  at: now,
  kind: 'report',
  note: '',
  outcome: 'solved',
};

const task = (
  id: string,
  owner: string,
  status: McpTaskStatus,
  history: McpTaskEvent[],
  opts: {
    idleHours?: number;
    rounds?: number;
    failures?: number;
    startedVia?: McpStartedVia | null;
    goal?: string;
  } = {},
) =>
  new McpTask(
    id,
    owner,
    opts.goal ?? `goal ${id}`,
    [],
    status,
    opts.rounds ?? history.filter((e) => e.kind !== 'report').length,
    history,
    hoursAgo((opts.idleHours ?? 1) + 1),
    hoursAgo(opts.idleHours ?? 1),
    null,
    opts.failures ?? 0,
    opts.startedVia === undefined ? 'start_task' : opts.startedVia,
  );

describe('computeMcpStats', () => {
  const started = [
    task('t1', 'kiro', 'solved', [answer, report]),
    task('t2', 'kiro', 'answered', [needInfo, answer], {
      idleHours: 30,
      startedVia: 'ask_advice',
    }),
    task('t3', 'kiro', 'escalated', [answer, report, answer, report], {
      rounds: 2,
      failures: 1,
    }),
    task('t4', 'smoke', 'abandoned', [needInfo], { startedVia: null }),
    task('t5', 'kiro', 'gathering', [], {
      idleHours: 50,
      startedVia: 'ask_advice',
    }),
  ];
  // Open tasks of any age: one started long before the period
  const old = task('t0', 'cursor', 'answered', [answer], { idleHours: 400 });
  const open = [old, ...started.filter((t) => t.isOpen)];
  const stats = computeMcpStats({ started, open, now, days: 7 });

  it('counts what started in the period and how it started', () => {
    expect(stats.started).toMatchObject({
      total: 5,
      // t2 and t5 skipped start_task; t4 predates the flag and is not counted
      skippedStart: 2,
      skippedStartShare: 0.5,
      // t1 and t3 answered and reported, t2 answered and never reported
      reportedShare: 0.67,
      silentlyDropped: 2,
    });
    expect(stats.started.byStatus).toMatchObject({
      solved: 1,
      answered: 1,
      escalated: 1,
      abandoned: 1,
      gathering: 1,
    });
  });

  it('counts silently dropped tasks against the solved share', () => {
    expect(stats.outcomes).toEqual({
      solved: 1,
      escalated: 1,
      abandoned: 1,
      silentlyDropped: 2,
      // 1 solved of 3 closed + 2 dropped
      solvedShare: 0.2,
    });
    expect(stats.rounds).toEqual({
      total: 6,
      perTask: 1.2,
      needInfoShare: 0.33,
      failedAttempts: 1,
    });
  });

  it('shows each client its own protocol discipline', () => {
    expect(stats.byClient).toEqual([
      {
        client: 'kiro',
        total: 4,
        solved: 1,
        escalated: 1,
        abandoned: 0,
        rounds: 5,
        failedAttempts: 1,
        skippedStart: 2,
        skippedStartShare: 0.5,
        reportedShare: 0.67,
        silentlyDropped: 2,
      },
      {
        client: 'smoke',
        total: 1,
        solved: 0,
        escalated: 0,
        abandoned: 1,
        rounds: 1,
        failedAttempts: 0,
        skippedStart: 0,
        skippedStartShare: null,
        reportedShare: null,
        silentlyDropped: 0,
      },
    ]);
  });

  it('lists open tasks of any age, the longest idle first, with short goals', () => {
    expect(stats.open).toMatchObject({
      total: 3,
      waitingForReport: 2,
      idleOverDay: 3,
    });
    expect(stats.open.stuck.map((s) => [s.id, s.idleHours])).toEqual([
      ['t0', 400],
      ['t5', 50],
      ['t2', 30],
    ]);
    // The caller's own array is left in its order
    expect(open[0].id).toBe('t0');

    const long = task('t9', 'kiro', 'gathering', [], { goal: 'x'.repeat(500) });
    const one = computeMcpStats({ started: [], open: [long], now, days: 1 });
    expect(one.open.stuck[0].goal).toHaveLength(120);
  });

  it('reports no shares for an empty period instead of dividing by zero', () => {
    const empty = computeMcpStats({ started: [], open: [], now, days: 1 });
    expect(empty.started.total).toBe(0);
    expect(empty.outcomes.solvedShare).toBeNull();
    expect(empty.started.reportedShare).toBeNull();
    expect(empty.rounds.perTask).toBeNull();
    expect(empty.period).toEqual({
      days: 1,
      from: '2026-09-27T12:00:00.000Z',
      to: '2026-09-28T12:00:00.000Z',
    });
  });

  it('keeps days in 1..30 and falls back to 7 on nonsense', () => {
    expect(clampStatsDays(undefined)).toBe(7);
    expect(clampStatsDays(NaN)).toBe(7);
    expect(clampStatsDays(0)).toBe(1);
    expect(clampStatsDays(90)).toBe(30);
    expect(clampStatsDays(3.7)).toBe(3);
  });
});
