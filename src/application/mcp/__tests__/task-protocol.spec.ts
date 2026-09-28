import { currentStateText } from '@application/mcp/task-protocol';
import {
  MAX_TASK_ROUNDS,
  McpTask,
  McpTaskStatus,
} from '@domain/mcp-task/mcp-task.entity';

const now = new Date('2026-09-28T12:00:00Z');
const task = (
  status: McpTaskStatus,
  inFlightSince: Date | null = null,
  rounds = 2,
  failures = 0,
) =>
  new McpTask(
    't-00000000aa',
    'default',
    'g',
    [],
    status,
    rounds,
    [],
    now,
    now,
    inFlightSince,
    failures,
  );

// What a caller is told when a write lost a race: always the task's state
describe('currentStateText', () => {
  it.each([
    ['closed', task('solved'), 'already closed (solved)'],
    ['escalated', task('escalated'), 'STOP trying fixes'],
    [
      'nothing left to try',
      task('not_solved', null, MAX_TASK_ROUNDS),
      'no attempts are left',
    ],
    [
      'running',
      task('answered', new Date(now.getTime() - 1000)),
      'still running',
    ],
    [
      'waiting for a report',
      task('answered'),
      'is waiting for your report on its last answer',
    ],
    [
      'out of rounds',
      task('answered', null, MAX_TASK_ROUNDS),
      `has used all ${MAX_TASK_ROUNDS} rounds`,
    ],
    [
      'out of attempts',
      task('answered', null, 1, 3),
      'has had 3 failed attempts',
    ],
    ['gathering', task('gathering'), 'is waiting for material'],
    ['reported', task('not_solved'), 'Recorded: not_solved'],
  ])('%s', (_, t, expected) => {
    expect(currentStateText(t, now)).toContain(expected);
  });
});
