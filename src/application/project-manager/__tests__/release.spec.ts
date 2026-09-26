import {
  addWorkingDays,
  ReleaseIssue,
  releaseView,
} from '@application/project-manager/release';

const NOW = new Date('2026-09-24T10:00:00Z'); // Thursday

const t = (key: string, over: Partial<ReleaseIssue>): ReleaseIssue => ({
  key,
  summary: `Summary ${key}`,
  type: 'Story',
  status: 'To Do',
  category: 'new',
  priority: 'Medium',
  assignee: 'Ann',
  reporter: 'Client',
  created: '2026-08-20T10:00:00Z',
  doneAt: null,
  statusSince: null,
  blockedBy: [],
  addedAt: '2026-08-20T10:00:00Z',
  ...over,
});

const done = (key: string, doneAt: string, over: Partial<ReleaseIssue> = {}) =>
  t(key, { category: 'done', status: 'Done', doneAt, ...over });

describe('addWorkingDays', () => {
  it('skips weekends', () => {
    expect(addWorkingDays(NOW, 2).toISOString().slice(0, 10)).toBe(
      '2026-09-28',
    );
  });
});

describe('releaseView', () => {
  const issues = [
    done('RL-1', '2026-09-14T10:00:00Z'),
    done('RL-2', '2026-09-16T10:00:00Z'),
    done('RL-3', '2026-09-22T10:00:00Z'),
    done('RL-4', '2026-09-23T10:00:00Z'),
    t('RL-5', {
      category: 'indeterminate',
      status: 'In Progress',
      statusSince: '2026-09-15T10:00:00Z',
    }),
    t('RL-6', { blockedBy: ['RL-5'], assignee: 'Bob' }),
    t('RL-7', { blockedBy: ['RL-5'], addedAt: '2026-09-21T10:00:00Z' }),
    t('RL-8', { addedAt: '2026-09-10T10:00:00Z', assignee: null }),
  ];

  it('forecasts the date from release pace and gives a verdict', () => {
    const v = releaseView({ version: '1.0', capped: false, issues }, NOW, {
      releaseDate: '2026-09-30',
    });
    expect(v.scope).toEqual({ total: 8, done: 4, open: 4, inProgress: 1 });
    // 4 closed in the last 10 working days → 0.4 a day; 4 open → 10 days
    expect(v.pace.perDay).toBe(0.4);
    expect(v.eta.date).toBe('2026-10-08');
    // Even the best recent week would not make it
    expect(v.eta.verdict).toBe('late');
    expect(v.eta.daysLate).toBe(6);
    expect(v.workingDaysLeft).toBe(4);
    expect(v.burnup).toHaveLength(30);
    expect(v.burnup[29]).toEqual({ day: '2026-09-24', scope: 8, done: 4 });
    expect(v.burnup[0]).toEqual({ day: '2026-08-26', scope: 6, done: 0 });
  });

  it('lists what was added after the baseline', () => {
    const v = releaseView({ version: '1.0', capped: false, issues }, NOW, {
      releaseDate: null,
      baseline: '2026-09-01',
    });
    expect(v.creep.added.map((a) => a.key)).toEqual(['RL-7', 'RL-8']);
    expect(v.creep.atBaseline).toBe(6);
    expect(v.creep.percent).toBe(33);
    expect(v.creep.addedLast7).toBe(1);
    expect(v.eta.verdict).toBe('unknown');
  });

  it('shows what the rest waits on and who holds too much', () => {
    const v = releaseView({ version: '1.0', capped: false, issues }, NOW, {
      releaseDate: '2026-09-30',
    });
    expect(v.critical[0]).toMatchObject({ key: 'RL-5', waiting: 2 });
    expect(v.people.map((p) => [p.name, p.open, p.risk])).toEqual([
      ['Ann', 2, true],
      ['Bob', 1, false],
    ]);
  });

  it('matches tickets to PR titles', () => {
    const v = releaseView({ version: '1.0', capped: false, issues }, NOW, {
      releaseDate: null,
      code: {
        authors: {
          ann: {
            open: [],
            merged14: ['api#9 RL-6 checkout', 'api#8 RL-4 fix'],
          },
        },
      },
    });
    expect(v.mismatches.map((m) => [m.key, m.kind])).toEqual([
      ['RL-5', 'progress-no-pr'],
      ['RL-6', 'merged-not-done'],
      ['RL-1', 'done-no-pr'],
      ['RL-2', 'done-no-pr'],
      ['RL-3', 'done-no-pr'],
    ]);
  });
});
