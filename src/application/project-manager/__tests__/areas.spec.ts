import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { IssueFact } from '@application/project-manager/metrics';
import { areaView, NO_AREA } from '@application/project-manager/areas';
import { buildTeam, teamIssues } from '@application/project-manager/team';

const NOW = new Date('2026-09-24T10:00:00Z');

const f = (key: string, over: Partial<IssueFact>): IssueFact => ({
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
  components: ['Payments'],
  ...over,
});

describe('areaView', () => {
  it('counts bugs by area, finds single-owner areas and bug share', () => {
    const done = [
      ...Array.from({ length: 5 }, (_, n) =>
        f(`P-${n}`, {
          category: 'done',
          doneAt: '2026-09-15T00:00:00Z',
          type: n < 3 ? 'Bug' : 'Story',
        }),
      ),
      f('P-9', {
        category: 'done',
        doneAt: '2026-09-15T00:00:00Z',
        assignee: 'Bob',
      }),
      f('C-1', {
        category: 'done',
        doneAt: '2026-06-01T00:00:00Z',
        components: ['Catalog'],
        assignee: 'Bob',
      }),
    ];
    const open = [f('P-20', { type: 'Bug' }), f('X-1', { components: [] })];
    const created = [
      f('B-1', { type: 'Bug', created: '2026-09-20T00:00:00Z' }),
      f('B-2', { type: 'Bug', created: '2026-09-01T00:00:00Z' }),
      f('B-3', {
        type: 'Bug',
        created: '2026-09-21T00:00:00Z',
        components: ['Catalog'],
      }),
    ];
    const a = areaView(open, done, created, NOW);
    const pay = a.areas.find((r) => r.name === 'Payments');
    expect(pay).toMatchObject({
      bugsNew: 1,
      bugsBefore: 1,
      openBugs: 1,
      openBugKeys: ['P-20'],
      open: 1,
      done: 6,
      owner: { name: 'Ann', share: 0.83 },
      backup: 'Bob',
      busRisk: true,
    });
    // Catalog: nothing open, so no risk even with one person
    expect(a.areas.find((r) => r.name === 'Catalog')?.busRisk).toBe(false);
    expect(a.areas[a.areas.length - 1].name).toBe(NO_AREA);
    expect(a.noAreaShare).toBe(0.5);
    expect(a.people.Ann).toEqual({ done: 5, bugs: 3 });
  });

  it('flags many areas at once and a mostly-bugs month on the card', () => {
    const open = ['Pay', 'Catalog', 'Auth'].map((c, n) =>
      f(`O-${n}`, { components: [c] }),
    );
    const issues = teamIssues(open, [], NOW, null, false);
    const snap = new ProjectSnapshot('s', NOW, [
      {
        source: 'issues',
        ok: true,
        fetchedAt: NOW,
        text: '',
        error: null,
        details: {
          ...issues,
          areas: {
            areas: [],
            noAreaShare: 0,
            people: { Ann: { done: 6, bugs: 4 } },
          },
        } as any,
      },
    ]);
    const ann = buildTeam(snap, {}, NOW).people[0];
    expect(ann.signals.map((s) => s.rule)).toEqual(
      expect.arrayContaining(['switching', 'unplanned']),
    );
    expect(ann.load.closed28).toEqual({ done: 6, bugs: 4 });
  });
});
