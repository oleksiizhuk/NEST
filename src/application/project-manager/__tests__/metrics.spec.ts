import {
  codeMetrics,
  IssueFact,
  issueMetrics,
  PullFact,
  RunFact,
  verdictHint,
} from '@application/project-manager/metrics';
import { workingDaysBetween } from '@application/project-manager/release-clock';

const NOW = new Date('2026-09-23T06:00:00Z'); // Wednesday

const issue = (key: string, over: Partial<IssueFact>): IssueFact => ({
  key,
  type: 'Story',
  status: 'To Do',
  category: 'new',
  priority: 'Medium',
  assignee: 'Ann',
  fixVersions: [],
  created: '2026-09-01T00:00:00Z',
  doneAt: null,
  statusSince: null,
  due: null,
  ...over,
});

const open = [
  issue('A-1', { priority: 'High', assignee: null, fixVersions: ['1.0'] }),
  issue('A-2', {
    category: 'indeterminate',
    statusSince: '2026-09-10T00:00:00Z',
    fixVersions: ['1.0'],
  }),
  issue('A-3', {
    type: 'Bug',
    category: 'indeterminate',
    priority: 'High',
    statusSince: '2026-09-22T00:00:00Z',
    created: '2026-09-20T00:00:00Z',
  }),
  issue('A-4', { type: 'Epic', fixVersions: ['1.0'] }),
  issue('A-5', {
    category: 'indeterminate',
    statusSince: '2026-09-22T00:00:00Z',
    due: '2026-09-20',
    fixVersions: ['1.0'],
  }),
];
const done = [
  issue('D-1', { category: 'done', doneAt: '2026-09-20T00:00:00Z' }),
  issue('D-2', {
    type: 'Bug',
    category: 'done',
    created: '2026-09-12T00:00:00Z',
    doneAt: '2026-09-15T00:00:00Z',
  }),
  issue('D-3', { category: 'done', doneAt: '2026-08-01T00:00:00Z' }),
];

describe('workingDaysBetween', () => {
  it('counts weekdays after the start up to the end', () => {
    expect(
      workingDaysBetween(new Date('2026-09-17'), new Date('2026-09-23')),
    ).toBe(4);
    expect(
      workingDaysBetween(new Date('2026-09-23'), new Date('2026-09-20')),
    ).toBe(0);
  });
});

describe('verdictHint', () => {
  it('maps the buffer to a verdict', () => {
    expect(verdictHint(null, 5)).toMatch('NO DATA');
    expect(verdictHint(4, 5)).toBe('ON TRACK');
    expect(verdictHint(5, 5)).toBe('AT RISK');
    expect(verdictHint(6, 5)).toBe('OFF TRACK');
    expect(verdictHint(1, 0)).toBe('RELEASE DAY OR PAST');
  });
});

describe('issueMetrics', () => {
  it('counts scope, pace, forecast and attention lists exactly', () => {
    const text = issueMetrics(open, done, NOW, {
      releaseDate: '2026-09-30',
      releaseVersion: '1.0',
      capped: false,
    });
    expect(text).toContain('Open work items: 4 — to do 1, in progress 3.');
    expect(text).toContain(
      'Finished in the last 14 days: 2 (0.2 per working day).',
    );
    expect(text).toContain(
      'Release scope (fixVersion 1.0): 3 open. At the current pace that needs 15 working days; 5 left. Hint: OFF TRACK.',
    );
    expect(text).toContain('Unassigned: 1, of them high priority 1: A-1.');
    expect(text).toContain(
      'In progress for more than 5 working days: 1 — A-2 9d Ann.',
    );
    expect(text).toContain('Past due date: 1 — A-5.');
    expect(text).toContain(
      'Open bugs: 1 (High 1); last 14 days: 2 reported, 1 fixed.',
    );
    expect(text).toContain('Load: Ann 3 open/3 in progress (WIP high).');
    expect(text).not.toContain('A-4');
  });

  it('shows the fixVersion split and marks capped counts as lower bounds', () => {
    const text = issueMetrics(open, done, NOW, {
      releaseDate: null,
      releaseVersion: null,
      capped: true,
    });
    expect(text).toContain('Open work items: 4 (lower bound: list capped)');
    expect(text).toContain('Open by fixVersion: 1.0 3; none 1.');
    expect(text).not.toContain('Hint:');
  });
});

describe('codeMetrics', () => {
  const pr = (number: number, over: Partial<PullFact>): PullFact => ({
    repo: 'api',
    number,
    author: 'dev',
    draft: false,
    createdAt: '2026-09-22T00:00:00Z',
    updatedAt: '2026-09-22T00:00:00Z',
    reviewDecision: null,
    reviews: 0,
    ...over,
  });
  const run = (over: Partial<RunFact>): RunFact => ({
    repo: 'api',
    workflow: 'Deploy',
    branch: 'main',
    conclusion: 'success',
    createdAt: '2026-09-20T00:00:00Z',
    ...over,
  });

  it('lists review waits, stalled change requests and red pipelines', () => {
    const text = codeMetrics(
      [
        pr(1, { createdAt: '2026-09-17T00:00:00Z' }),
        pr(2, { draft: true, createdAt: '2026-09-01T00:00:00Z' }),
        pr(3, {}),
        pr(4, {
          reviewDecision: 'CHANGES_REQUESTED',
          reviews: 1,
          updatedAt: '2026-09-18T00:00:00Z',
        }),
      ],
      [
        run({ conclusion: 'failure', createdAt: '2026-09-22T00:00:00Z' }),
        run({ conclusion: 'failure', createdAt: '2026-09-21T00:00:00Z' }),
        run({ conclusion: 'success', createdAt: '2026-09-20T00:00:00Z' }),
        run({ workflow: 'CI', branch: 'dev', conclusion: null }),
        run({ workflow: 'CI', branch: 'dev', conclusion: 'success' }),
      ],
      NOW,
    );
    expect(text).toContain('Open PRs: 4 (1 drafts).');
    expect(text).toContain(
      'Waiting for a first review more than 2 working days: api#1 dev 4d.',
    );
    expect(text).toContain(
      'Changes requested, no update for 2+ working days: api#4 dev.',
    );
    expect(text).toContain(
      'Red pipelines: api:Deploy@main since 2026-09-21 (2 working days).',
    );
    expect(text).not.toContain('unavailable');
  });

  it('says when review state is unknown instead of reporting no waits', () => {
    const text = codeMetrics(
      [pr(1, { reviews: undefined, reviewDecision: undefined })],
      [],
      NOW,
    );
    expect(text).toContain('Review state: unavailable for some repos.');
    expect(text).toContain('Red pipelines: none.');
  });
});
