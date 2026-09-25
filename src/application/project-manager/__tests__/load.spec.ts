import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { IssueFact } from '@application/project-manager/metrics';
import {
  pacePerDay,
  scopeGrowing,
  weeklyFlow,
} from '@application/project-manager/load';
import {
  buildTeam,
  teamIssues,
  todayItems,
} from '@application/project-manager/team';

const NOW = new Date('2026-09-24T10:00:00Z'); // Thursday; week of 21.09

const fact = (key: string, over: Partial<IssueFact>): IssueFact => ({
  key,
  summary: `Summary ${key}`,
  type: 'Story',
  status: 'To Do',
  category: 'new',
  priority: 'Medium',
  assignee: null,
  fixVersions: ['1.0'],
  created: null,
  doneAt: null,
  statusSince: null,
  due: null,
  ...over,
});

describe('weeklyFlow', () => {
  it('counts closed per person and created per week, Monday to Sunday', () => {
    const flow = weeklyFlow(
      [
        fact('A-1', { assignee: 'Ann', doneAt: '2026-09-21T08:00:00Z' }),
        fact('A-2', { assignee: 'Ann', doneAt: '2026-09-20T23:00:00Z' }),
        fact('A-2', { assignee: 'Ann', doneAt: '2026-09-20T23:00:00Z' }),
        fact('E-1', { type: 'Epic', assignee: 'Ann', doneAt: '2026-09-21' }),
        fact('B-1', { assignee: 'Bob', doneAt: '2026-06-01T00:00:00Z' }),
      ],
      [
        fact('N-1', { created: '2026-09-22T00:00:00Z' }),
        fact('N-2', { created: '2026-09-15T00:00:00Z' }),
      ],
      NOW,
      false,
      3,
    );
    expect(flow.weeks).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
    expect(flow.done).toEqual([0, 1, 1]);
    expect(flow.created).toEqual([0, 1, 1]);
    expect(flow.people).toEqual({ Ann: [0, 1, 1] });
  });

  it('paces over the last four full weeks and spots growing scope', () => {
    expect(pacePerDay([9, 5, 5, 5, 5, 3])).toBe(1);
    expect(pacePerDay([0, 0, 2])).toBeNull();
    expect(
      scopeGrowing({
        weeks: ['a', 'b', 'c', 'd'],
        done: [5, 2, 3, 9],
        created: [1, 4, 5, 0],
        people: {},
        capped: false,
      }),
    ).toBe(true);
    expect(
      scopeGrowing({
        weeks: ['a', 'b', 'c'],
        done: [2, 6, 0],
        created: [4, 5, 9],
        people: {},
        capped: false,
      }),
    ).toBe(false);
  });
});

describe('team load', () => {
  const inProgress = (key: string, who: string) =>
    fact(key, {
      assignee: who,
      category: 'indeterminate',
      status: 'In Progress',
      statusSince: '2026-09-23T00:00:00Z',
    });
  const queued = (key: string, who: string) => fact(key, { assignee: who });

  const team = (weekly: Record<string, number[]>) => {
    const issues = teamIssues(
      [
        inProgress('A-1', 'Ann'),
        ...['A-2', 'A-3', 'A-4', 'A-5', 'A-6', 'A-7'].map((k) =>
          queued(k, 'Ann'),
        ),
        inProgress('B-1', 'Bob'),
        queued('B-2', 'Bob'),
        inProgress('C-1', 'Cid'),
        queued('C-2', 'Cid'),
        inProgress('D-1', 'Dee'),
        fact('F-1', { priority: 'Low', fixVersions: [] }),
        fact('F-2', { priority: 'High' }),
      ],
      [],
      NOW,
      '1.0',
      false,
    );
    const weeks = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
    return buildTeam(
      new ProjectSnapshot('s', NOW, [
        {
          source: 'issues',
          ok: true,
          fetchedAt: NOW,
          text: '',
          error: null,
          details: {
            ...issues,
            flow: {
              weeks,
              done: [4, 4, 4, 1],
              created: [2, 6, 6, 1],
              people: weekly,
              capped: false,
            },
          } as any,
        },
      ]),
      {},
      NOW,
    );
  };

  it('flags overload and underload against the team median', () => {
    const t = team({ Dee: [5, 5, 5, 0] });
    const by = (n: string) => t.people.find((p) => p.name === n);
    expect(by('Ann')?.load).toMatchObject({
      total: 7,
      median: 2,
      ratio: 3.5,
      badge: 'over',
    });
    const over = by('Ann')?.signals.find((s) => s.rule === 'overload');
    expect(over?.keys).toEqual(['A-2', 'A-3', 'A-4']);
    expect(by('Dee')?.load.badge).toBe('under');
    // Free work: release scope first, then priority
    expect(t.unassigned.map((i) => i.key)).toEqual(['F-2', 'F-1']);
    expect(
      by('Dee')?.signals.find((s) => s.rule === 'underload')?.keys,
    ).toEqual(['F-2', 'F-1']);
    expect(t.scopeGrowing).toBe(true);
  });

  it('warns when work is about to run out at the person pace', () => {
    const t = team({ Dee: [5, 5, 5, 0] });
    const dee = t.people.find((p) => p.name === 'Dee');
    // 1 open task at 1 per day
    expect(dee?.load.pace).toBe(1);
    expect(dee?.load.runwayDays).toBe(1);
    expect(dee?.signals.find((s) => s.rule === 'runway')?.text).toBe(
      'Работы примерно на 1 раб. дн. — пора планировать следующее.',
    );
    // Nobody who closed nothing gets a runway guess
    const bob = t.people.find((p) => p.name === 'Bob');
    expect(bob?.load.pace).toBeNull();
    expect(bob?.signals.some((s) => s.rule === 'runway')).toBe(false);
  });

  it('keeps the median to people with open work and badges nobody away', () => {
    const issues = teamIssues(
      [
        ...['A-1', 'A-2', 'A-3', 'A-4', 'A-5'].map((k) => queued(k, 'Ann')),
        inProgress('B-1', 'Bob'),
        queued('B-2', 'Bob'),
        inProgress('C-1', 'Cid'),
        queued('C-2', 'Cid'),
        inProgress('D-1', 'Dee'),
        queued('D-2', 'Dee'),
      ],
      ['Lead', 'QA', 'Left'].map((who, i) =>
        fact(`X-${i}`, {
          assignee: who,
          category: 'done',
          doneAt: '2026-09-20T00:00:00Z',
        }),
      ),
      NOW,
      '1.0',
      false,
    );
    const t = buildTeam(
      new ProjectSnapshot('s', NOW, [
        {
          source: 'issues',
          ok: true,
          fetchedAt: NOW,
          text: '',
          error: null,
          details: issues as any,
        },
      ]),
      {},
      NOW,
      { away: { Dee: { until: '2026-10-01' } } },
    );
    const by = (n: string) => t.people.find((p) => p.name === n);
    // Median of Ann 5, Bob 2, Cid 2 — the three with nothing open do not count
    expect(by('Bob')?.load.median).toBe(2);
    expect(by('Bob')?.load.badge).toBe('normal');
    expect(by('Ann')?.load.badge).toBe('over');
    expect(by('Dee')?.load.badge).toBeNull();
    const lead = by('Lead')?.signals.find((s) => s.rule === 'runway');
    expect(lead).toMatchObject({ level: 'info', subject: 'load' });
  });

  it('hides load items by person, not by the suggested tickets', () => {
    const t = team({ Dee: [5, 5, 5, 0] });
    const items = todayItems(t.people, new Set(), 20).items;
    expect(items.find((i) => i.rule === 'underload')?.id).toBe(
      'underload|Dee|load',
    );
  });
});
