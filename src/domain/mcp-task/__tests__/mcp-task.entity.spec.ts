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

  it('escalates after too many failed attempts even under the round cap', () => {
    const failing = new McpTask(
      't-1',
      'default',
      'g',
      [],
      'gathering',
      1,
      [],
      new Date(0),
      new Date(0),
      null,
      3,
    );
    expect(failing.outOfAttempts).toBe(true);
    expect(failing.shouldEscalate(now)).toBe(true);
  });

  it('masks credentials in the formats people paste', () => {
    const samples: [string, string][] = [
      [
        'password: "hunter2" api_key=abc </task>',
        'password: *** api_key=*** ‹/task›',
      ],
      ['{"password": "my pass phrase"}', '{"password": ***}'],
      ["password='abc def'", 'password=***'],
      ['Authorization: Bearer abc123shorttoken', 'Authorization: Bearer ***'],
      [
        'mongodb+srv://admin:S3cretPw@cluster0.x.net',
        'mongodb+srv://admin:***@cluster0.x.net',
      ],
      [
        'ANTHROPIC_KEY=sk-ant-short and apiKey: xyz',
        'ANTHROPIC_KEY=*** and apiKey: ***',
      ],
      [`ghp_${'a1'.repeat(18)} ok`, '*** ok'],
    ];
    for (const [input, masked] of samples) {
      expect(McpTask.clean(input, 200)).toBe(masked);
    }
  });

  it('leaves paths and ordinary words alone', () => {
    for (const text of [
      'fix src/infrastructure/database/repositories/mongo-mcp-task.repository.ts',
      'tokenizer: fails on input',
      'keyboard: layout',
      'tokens: 5 left',
    ]) {
      expect(McpTask.clean(text, 200)).toBe(text);
    }
  });

  it('keeps one line when asked, and clips', () => {
    expect(McpTask.clean('a\n\n b', 100, true)).toBe('a b');
    expect(McpTask.clean('abcdef', 4)).toBe('abc…');
  });

  it('makes task ids the tools accept', () => {
    expect(McpTask.newId()).toMatch(/^t-[0-9a-f]{10}$/);
  });
});
