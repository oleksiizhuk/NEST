import { computeMcpStats } from '@application/mcp/mcp-stats';
import {
  McpTask,
  McpTaskEvent,
  McpTaskStatus,
} from '@domain/mcp-task/mcp-task.entity';

const now = new Date('2026-09-28T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const answer: McpTaskEvent = { at: now, kind: 'answer', note: 'h' };
const needInfo: McpTaskEvent = { at: now, kind: 'need_info', note: 'n' };
const report: McpTaskEvent = {
  at: now,
  kind: 'report',
  note: 'r',
  outcome: 'solved',
};

const task = (
  id: string,
  owner: string,
  status: McpTaskStatus,
  history: McpTaskEvent[],
  idleHours = 1,
  rounds = history.filter((e) => e.kind !== 'report').length,
  failures = 0,
) =>
  new McpTask(
    id,
    owner,
    `goal ${id}`,
    [],
    status,
    rounds,
    history,
    hoursAgo(idleHours + 1),
    hoursAgo(idleHours),
    null,
    failures,
  );

describe('computeMcpStats', () => {
  const tasks = [
    task('t1', 'kiro', 'solved', [answer, report]),
    task('t2', 'kiro', 'answered', [needInfo, answer], 30),
    task('t3', 'kiro', 'escalated', [answer, report, answer, report], 2, 2, 1),
    task('t4', 'smoke', 'abandoned', [needInfo]),
    task('t5', 'kiro', 'gathering', [], 50),
  ];
  const stats = computeMcpStats(tasks, now, 7);

  it('counts tasks, statuses and what waits', () => {
    expect(stats.tasks).toMatchObject({
      total: 5,
      open: 2,
      closed: 3,
      waitingForReport: 1,
      idleOverDay: 2,
    });
    expect(stats.tasks.byStatus).toMatchObject({
      solved: 1,
      answered: 1,
      escalated: 1,
      abandoned: 1,
      gathering: 1,
      not_solved: 0,
      partial: 0,
    });
  });

  it('measures outcomes and whether IDEs report back', () => {
    expect(stats.outcomes).toEqual({
      solved: 1,
      escalated: 1,
      abandoned: 1,
      solvedShare: 0.33,
    });
    // t1 and t3 were answered and reported, t2 was answered and never was
    expect(stats.reportedShare).toBe(0.67);
    expect(stats.rounds).toEqual({
      total: 6,
      perTask: 1.2,
      needInfoShare: 0.33,
      failedAttempts: 1,
    });
  });

  it('splits by client and lists the longest-idle open tasks first', () => {
    expect(stats.byClient).toEqual([
      {
        client: 'kiro',
        total: 4,
        open: 2,
        solved: 1,
        escalated: 1,
        abandoned: 0,
        waitingForReport: 1,
      },
      {
        client: 'smoke',
        total: 1,
        open: 0,
        solved: 0,
        escalated: 0,
        abandoned: 1,
        waitingForReport: 0,
      },
    ]);
    expect(stats.stuck.map((s) => [s.id, s.idleHours])).toEqual([
      ['t5', 50],
      ['t2', 30],
    ]);
  });

  it('reports no shares for an empty period instead of dividing by zero', () => {
    const empty = computeMcpStats([], now, 1);
    expect(empty.tasks.total).toBe(0);
    expect(empty.outcomes.solvedShare).toBeNull();
    expect(empty.reportedShare).toBeNull();
    expect(empty.rounds.perTask).toBeNull();
    expect(empty.period).toEqual({
      days: 1,
      from: '2026-09-27T12:00:00.000Z',
      to: '2026-09-28T12:00:00.000Z',
    });
  });
});
