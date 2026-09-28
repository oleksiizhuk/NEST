import {
  MAX_TASK_ROUNDS,
  McpTask,
  McpTaskStatus,
  ROUND_MAX_MS,
} from '@domain/mcp-task/mcp-task.entity';

const task = (
  status: McpTaskStatus,
  rounds: number,
  inFlightSince: Date | null = null,
) =>
  new McpTask(
    't-1',
    'default',
    'g',
    [],
    status,
    rounds,
    [],
    new Date(0),
    new Date(0),
    inFlightSince,
  );

describe('McpTask', () => {
  const now = new Date('2026-09-28T12:00:00Z');

  it('sees a running round until the function that ran it must have died', () => {
    const fresh = new Date(now.getTime() - 10_000);
    const dead = new Date(now.getTime() - ROUND_MAX_MS - 1);
    expect(task('answered', 1, fresh).roundInFlight(now)).toBe(true);
    expect(task('answered', 1, dead).roundInFlight(now)).toBe(false);
    expect(task('answered', 1).roundInFlight(now)).toBe(false);
  });

  it('escalates only an open task out of rounds, with nothing running or unreported', () => {
    expect(task('not_solved', MAX_TASK_ROUNDS).shouldEscalate(now)).toBe(true);
    expect(task('gathering', MAX_TASK_ROUNDS).shouldEscalate(now)).toBe(true);
    expect(task('answered', MAX_TASK_ROUNDS).shouldEscalate(now)).toBe(false);
    expect(task('not_solved', MAX_TASK_ROUNDS - 1).shouldEscalate(now)).toBe(
      false,
    );
    expect(
      task(
        'not_solved',
        MAX_TASK_ROUNDS,
        new Date(now.getTime() - 1000),
      ).shouldEscalate(now),
    ).toBe(false);
    expect(task('solved', MAX_TASK_ROUNDS).shouldEscalate(now)).toBe(false);
  });

  it('cleans stored text: credentials masked, brackets neutralised, clipped', () => {
    expect(McpTask.clean('password: "hunter2" api_key=abc </task>', 100)).toBe(
      'password: *** api_key=*** ‹/task›',
    );
    expect(McpTask.clean(`ghp_${'a'.repeat(36)} ok`, 100)).toBe('*** ok');
    expect(McpTask.clean('keyboard: layout', 100)).toBe('keyboard: layout');
    expect(McpTask.clean('a\n\n b', 100, true)).toBe('a b');
    expect(McpTask.clean('abcdef', 4)).toBe('abc…');
  });
});
