import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { IssueFact } from '@application/project-manager/metrics';
import {
  buildTeam,
  teamIssues,
  todayItems,
} from '@application/project-manager/team';

const NOW = new Date('2026-09-24T10:00:00Z'); // Thursday

const f = (key: string, over: Partial<IssueFact>): IssueFact => ({
  key,
  type: 'Story',
  status: 'In Progress',
  category: 'indeterminate',
  priority: 'Medium',
  assignee: 'Vlad',
  fixVersions: [],
  created: '2026-08-01T00:00:00Z',
  doneAt: null,
  statusSince: '2026-09-22T00:00:00Z',
  due: null,
  ...over,
});

const stageOf = (status: string) =>
  /qa/i.test(status) ? 'qa' : /review/i.test(status) ? 'review' : 'dev';

const team = (open: IssueFact[]) =>
  buildTeam(
    new ProjectSnapshot('s', NOW, [
      {
        source: 'issues',
        ok: true,
        fetchedAt: NOW,
        text: '',
        error: null,
        details: teamIssues(open, [], NOW, null, false, {
          stage: stageOf,
        }) as any,
      },
    ]),
    {},
    NOW,
  );

describe('honest load', () => {
  const t = team([
    f('A-1', {}),
    f('A-2', { status: 'In Review' }),
    ...['A-3', 'A-4', 'A-5'].map((k) =>
      f(k, { status: 'Ready For Qa', statusSince: '2026-08-20T00:00:00Z' }),
    ),
    f('A-6', { status: 'Ready For Qa' }),
  ]);
  const vlad = t.people[0];

  it('counts only development as in progress; review and QA wait apart', () => {
    expect(vlad.inProgress.map((i) => i.key)).toEqual(['A-1']);
    expect(vlad.waiting.map((i) => i.key)).toEqual([
      'A-2',
      'A-3',
      'A-4',
      'A-5',
      'A-6',
    ]);
    expect(vlad.load.total).toBe(1);
    // Neither "too many at once" nor "stuck" for work sitting in QA
    expect(vlad.signals.map((s) => s.rule)).not.toContain('wip');
    expect(vlad.signals.map((s) => s.rule)).not.toContain('stale');
  });

  it('raises one team signal for the QA queue on Сегодня', () => {
    expect(t.teamSignals).toHaveLength(1);
    expect(t.teamSignals[0]).toMatchObject({
      rule: 'qa-queue',
      keys: ['A-3', 'A-4', 'A-5'],
    });
    expect(t.teamSignals[0].text).toContain('3 задачи ждут тестирования');
    expect(t.teamSignals[0].text).toContain('всего в очереди: 4');
    const today = todayItems(t.people, new Set(), 5, t.teamSignals);
    expect(today.items[0]).toMatchObject({
      rule: 'qa-queue',
      person: 'Команда',
      id: 'qa-queue|Команда|qa:A-3',
    });
  });

  it('can be switched off', () => {
    const quiet = buildTeam(
      new ProjectSnapshot('s', NOW, [
        {
          source: 'issues',
          ok: true,
          fetchedAt: NOW,
          text: '',
          error: null,
          details: teamIssues(
            [f('A-3', { status: 'Ready For Qa', statusSince: '2026-08-20' })],
            [],
            NOW,
            null,
            false,
            { stage: stageOf },
          ) as any,
        },
      ]),
      {},
      NOW,
      { thresholds: { off: ['qa-queue'] } },
    );
    expect(quiet.teamSignals).toEqual([]);
  });

  it('keeps blocked and overdue work in review or QA, and flags a stuck review', () => {
    const t2 = team([
      f('B-1', {
        status: 'In Review',
        priority: 'Highest',
        blockedBy: ['X-1'],
        statusSince: '2026-09-01T00:00:00Z',
        statusExact: true,
      }),
      f('B-2', {
        status: 'Ready For Qa',
        due: '2026-09-01',
        statusExact: true,
      }),
    ]);
    const rules = t2.people[0].signals.map((s) => s.rule);
    expect(rules).toContain('blocked');
    expect(rules).toContain('overdue');
    expect(t2.teamSignals.map((s) => s.text)).toEqual([
      expect.stringContaining('1 задача ждёт ревью кода'),
    ]);
  });

  it('does not call a tester idle or count a QA wait it cannot date', () => {
    const t3 = team([
      f('C-1', {
        assignee: 'Ira',
        status: 'Ready For Qa',
        statusSince: '2026-08-01T00:00:00Z',
        statusExact: false,
      }),
    ]);
    const ira = t3.people[0];
    expect(ira.signals.map((s) => s.rule)).not.toContain('runway');
    expect(ira.waiting[0].days).toBeNull();
    expect(t3.teamSignals).toEqual([]);
  });

  it('does not say "work runs out" when everything left is in review or QA', () => {
    const snap = new ProjectSnapshot('s', NOW, [
      {
        source: 'issues',
        ok: true,
        fetchedAt: NOW,
        text: '',
        error: null,
        details: teamIssues(
          [
            f('D-1', {
              assignee: 'Dee',
              status: 'Ready For Qa',
              statusExact: true,
            }),
          ],
          ['D-8', 'D-9'].map((k) =>
            f(k, {
              assignee: 'Dee',
              category: 'done',
              status: 'Done',
              doneAt: '2026-09-20T00:00:00Z',
            }),
          ),
          NOW,
          null,
          false,
          { stage: stageOf },
        ) as any,
      },
    ]);
    const dee = buildTeam(snap, {}, NOW).people[0];
    expect(dee.load.pace).not.toBeNull();
    expect(dee.signals.map((s) => s.rule)).not.toContain('runway');
    expect(t.teamSignals[0].text).toMatch(/^3 задачи ждут/);
  });
});
