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

  it('shows a ticket tagged in after it closed as done, but not as pace', () => {
    const v = releaseView(
      {
        version: '1.0',
        capped: false,
        issues: [
          ...Array.from({ length: 5 }, (_, n) =>
            done(`RL-${n + 10}`, '2026-06-01T10:00:00Z', {
              addedAt: '2026-09-24T09:00:00Z',
            }),
          ),
          done('RL-30', '2026-09-23T10:00:00Z', { doneAt: null }),
          t('RL-20', {}),
        ],
      },
      NOW,
      { releaseDate: '2026-09-30' },
    );
    expect(v.burnup[28].done).toBe(1);
    expect(v.burnup[29].done).toBe(6);
    // Old work tagged today is not release pace; a close without a date
    // does not crash anything
    expect(v.pace.perDay).toBeNull();
    expect(v.eta).toMatchObject({ date: null, verdict: 'late' });
  });

  it('keeps the range around the forecast, a zero week included', () => {
    const v = releaseView(
      {
        version: '1.0',
        capped: false,
        issues: [
          done('RL-1', '2026-09-22T10:00:00Z'),
          done('RL-2', '2026-09-23T10:00:00Z'),
          t('RL-3', {}),
          t('RL-4', {}),
        ],
      },
      NOW,
      { releaseDate: '2026-10-30' },
    );
    expect(v.pace.worst).toBeNull();
    expect(v.eta.late).toBeNull();
    expect(v.eta.date && v.eta.early && v.eta.early <= v.eta.date).toBe(true);
  });

  it('says late without a forecast when nothing closed for two weeks', () => {
    const v = releaseView(
      { version: '1.0', capped: false, issues: [t('RL-1', {})] },
      NOW,
      { releaseDate: '2026-10-30' },
    );
    expect(v.eta).toMatchObject({ date: null, verdict: 'late' });
  });

  it('dates a finished release by its last close', () => {
    const v = releaseView(
      {
        version: '1.0',
        capped: false,
        issues: [done('RL-1', '2026-09-17T10:00:00Z')],
      },
      NOW,
      { releaseDate: '2026-09-18' },
    );
    expect(v.eta).toMatchObject({
      date: '2026-09-17',
      verdict: 'on-track',
      daysLate: 0,
    });
    const old = releaseView(
      {
        version: '1.0',
        capped: false,
        issues: [done('RL-1', '2026-09-17T10:00:00Z')],
      },
      NOW,
      { releaseDate: '2026-09-18', baseline: '2026-02-31' },
    );
    expect(old.creep.custom).toBe(false);
  });

  it('does not flag a merged ticket that is in review or QA', () => {
    const v = releaseView(
      {
        version: '1.0',
        capped: false,
        issues: [
          t('RL-1', { category: 'indeterminate', status: 'QA', stage: 'qa' }),
          t('RL-2', {
            category: 'indeterminate',
            status: 'In Progress',
            stage: 'dev',
          }),
        ],
      },
      NOW,
      {
        releaseDate: null,
        code: {
          authors: {
            a: { open: [], merged14: ['api#1 RL-1 x', 'api#2 RL-2 y'] },
          },
        },
      },
    );
    expect(v.mismatches.map((m) => [m.key, m.kind])).toEqual([
      ['RL-2', 'merged-not-done'],
    ]);
  });
});
