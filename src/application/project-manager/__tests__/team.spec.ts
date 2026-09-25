import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { IssueFact } from '@application/project-manager/metrics';
import {
  buildTeam,
  PersonView,
  teamIssues,
  todayItems,
} from '@application/project-manager/team';
import { TeamReviewUseCase } from '@application/project-manager/use-cases/team-review.use-case';
import { cleanSettings } from '@application/project-manager/settings.interface';

const NOW = new Date('2026-09-24T10:00:00Z'); // Thursday

const fact = (key: string, over: Partial<IssueFact>): IssueFact => ({
  key,
  summary: `Summary ${key}`,
  type: 'Story',
  status: 'To Do',
  category: 'new',
  priority: 'Medium',
  assignee: 'Ann Lee',
  fixVersions: ['1.0'],
  created: null,
  doneAt: null,
  statusSince: null,
  due: null,
  ...over,
});

const snapshot = () => {
  const issues = teamIssues(
    [
      fact('A-1', {
        category: 'indeterminate',
        status: 'In Progress',
        fixVersions: [],
        statusSince: '2026-09-10T00:00:00Z',
      }),
      fact('A-2', {
        category: 'indeterminate',
        status: 'In Progress',
        fixVersions: [],
      }),
      fact('A-3', { category: 'indeterminate', status: 'In Progress' }),
      fact('A-4', { priority: 'High' }),
      fact('B-1', {
        assignee: 'Bob',
        category: 'indeterminate',
        status: 'In Progress',
        statusSince: '2026-09-23T00:00:00Z',
      }),
      fact('X-1', { assignee: null }),
    ],
    [
      fact('B-0', {
        assignee: 'Bob',
        category: 'done',
        doneAt: '2026-09-20T00:00:00Z',
      }),
    ],
    NOW,
    '1.0',
    false,
  );
  const code = {
    authors: {
      'bob-gh': {
        open: [
          {
            repo: 'api',
            number: 7,
            title: 'B-1 checkout',
            waitingDays: 4,
            review: 'no review yet',
            draft: false,
          },
        ],
        merged14: ['api#6 B-0'],
      },
      'someone-else': { open: [], merged14: ['web#1 x'] },
    },
  };
  return new ProjectSnapshot('s', NOW, [
    {
      source: 'issues',
      ok: true,
      fetchedAt: NOW,
      text: '',
      error: null,
      details: issues as any,
    },
    {
      source: 'code',
      ok: true,
      fetchedAt: NOW,
      text: '',
      error: null,
      details: code as any,
    },
  ]);
};

describe('buildTeam', () => {
  it('shows who is on what and flags work in the wrong direction', () => {
    const team = buildTeam(snapshot(), { Bob: 'bob-gh' }, NOW);
    expect(team.people.map((p) => p.name)).toEqual(['Ann Lee', 'Bob']);
    const ann = team.people[0];
    expect(ann.inProgress.map((i) => [i.key, i.days])).toEqual([
      ['A-1', 10],
      ['A-2', null],
      ['A-3', null],
    ]);
    const texts = ann.signals.map((s) => s.text).join(' | ');
    expect(texts).toContain('В работе 3 задач сразу');
    expect(texts).toContain('A-1 в статусе «In Progress» уже 10 раб. дн.');
    expect(texts).toContain(
      '2 из 3 задач в работе не из релиза 1.0, а релизные ждут: A-4',
    );
    expect(texts).toContain(
      'В очереди приоритетнее, чем то, что в работе: A-4',
    );
    expect(texts).toContain('За 14 дней ничего не закрыто');

    const bob = team.people[1];
    expect(bob.github).toBe('bob-gh');
    expect(bob.done14.map((d) => d.key)).toEqual(['B-0']);
    expect(bob.merged14).toEqual(['api#6 B-0']);
    expect(bob.signals.map((s) => s.text)).toEqual([
      'PR api#7 ждёт ревью 4 раб. дн.',
    ]);
    expect(team.unmatchedGithub).toEqual(['someone-else']);
  });

  it('says "по плану" when nothing is off', () => {
    const snap = new ProjectSnapshot('s', NOW, [
      {
        source: 'issues',
        ok: true,
        fetchedAt: NOW,
        text: '',
        error: null,
        details: teamIssues(
          [
            fact('C-1', {
              assignee: 'Cid',
              category: 'indeterminate',
              statusSince: '2026-09-23T00:00:00Z',
            }),
          ],
          [
            fact('C-0', {
              assignee: 'Cid',
              category: 'done',
              doneAt: '2026-09-22T00:00:00Z',
            }),
          ],
          NOW,
          '1.0',
          false,
        ) as any,
      },
    ]);
    expect(buildTeam(snap, {}, NOW).people[0].signals).toEqual([
      {
        level: 'ok',
        rule: 'ok',
        text: 'Идёт по плану: явных проблем в данных нет.',
        keys: [],
      },
    ]);
  });

  it('explains each signal and suggests what to say', () => {
    const ann = buildTeam(snapshot(), {}, NOW).people[0];
    const stale = ann.signals.find((s) => s.rule === 'stale');
    expect(stale).toMatchObject({
      keys: ['A-1'],
      why: 'в «In Progress» с 10.09: 10 раб. дн. > порог 5',
      say: 'A-1 в работе 10 дней — что мешает закрыть? Нужна помощь?',
    });
    expect(ann.signals.find((s) => s.rule === 'wip')?.why).toBe(
      'в работе 3 > порог 2',
    );
  });

  it('uses the owner thresholds and switched-off rules', () => {
    const ann = buildTeam(snapshot(), {}, NOW, {
      thresholds: {
        wipLimit: 3,
        staleDays: 10,
        reviewWaitDays: 2,
        off: ['no-output', 'priority'],
      },
    }).people[0];
    expect(ann.signals.map((s) => s.rule)).toEqual(['off-release']);
    const bob = buildTeam(snapshot(), { Bob: 'bob-gh' }, NOW, {
      thresholds: { wipLimit: 2, staleDays: 5, reviewWaitDays: 4, off: [] },
    }).people[1];
    expect(bob.signals.map((s) => s.rule)).toEqual(['ok']);
  });

  it('keeps quiet about someone away, except release work to hand over', () => {
    const team = buildTeam(snapshot(), {}, NOW, {
      away: {
        'Ann Lee': { until: '2026-10-02', note: 'отпуск' },
        Bob: { until: '2026-09-23' },
      },
    });
    const ann = team.people.find((p) => p.name === 'Ann Lee') as PersonView;
    expect(ann.away).toEqual({ until: '2026-10-02', note: 'отпуск' });
    expect(ann.signals.map((s) => [s.rule, s.keys])).toEqual([
      ['away', []],
      ['handover', ['A-3']],
    ]);
    expect(ann.signals[0].text).toContain('Отсутствует до 02.10 (отпуск)');
    // An absence that ended yesterday no longer counts
    const bob = team.people.find((p) => p.name === 'Bob') as PersonView;
    expect(bob.signals.some((s) => s.rule === 'away')).toBe(false);
  });

  it('ranks today items across people and skips hidden ones', () => {
    const team = buildTeam(snapshot(), { Bob: 'bob-gh' }, NOW);
    const { items, more } = todayItems(team.people, new Set(), 3);
    expect(items.map((i) => [i.rule, i.person])).toEqual([
      ['off-release', 'Ann Lee'],
      ['pr-wait', 'Bob'],
      ['stale', 'Ann Lee'],
    ]);
    expect(items[0]).toMatchObject({
      id: 'off-release|Ann Lee|A-4',
      inRelease: true,
    });
    expect(more).toBe(3);
    const next = todayItems(team.people, new Set([items[0].id]), 3);
    expect(next.items[0].rule).toBe('pr-wait');
  });

  it('validates thresholds and absences', () => {
    expect(
      cleanSettings({
        teamThresholds: {
          wipLimit: 3,
          staleDays: 7,
          reviewWaitDays: 2,
          off: ['idle', 'idle'],
        },
      }),
    ).toEqual({
      teamThresholds: {
        wipLimit: 3,
        staleDays: 7,
        reviewWaitDays: 2,
        runwayDays: 2,
        off: ['idle'],
      },
    });
    expect(() =>
      cleanSettings({
        teamThresholds: { wipLimit: 0, staleDays: 7, reviewWaitDays: 2 },
      }),
    ).toThrow('wipLimit');
    expect(() =>
      cleanSettings({
        teamThresholds: {
          wipLimit: 2,
          staleDays: 7,
          reviewWaitDays: 2,
          off: ['away'],
        },
      }),
    ).toThrow('teamThresholds.off');
    expect(
      cleanSettings({ teamAway: { 'J. Smith': { until: '2026-10-01' } } }),
    ).toEqual({
      teamAway: { 'J. Smith': { until: '2026-10-01', note: null } },
    });
    expect(() =>
      cleanSettings({ teamAway: { Ann: { until: '1 Oct' } } }),
    ).toThrow('YYYY-MM-DD');
  });

  it('validates GitHub links', () => {
    expect(cleanSettings({ githubLogins: { 'Ann Lee': 'ann-l' } })).toEqual({
      githubLogins: { 'Ann Lee': 'ann-l' },
    });
    expect(() =>
      cleanSettings({ githubLogins: { 'Ann Lee': 'bad login' } }),
    ).toThrow('bad login');
    expect(cleanSettings({ githubLogins: { 'J. Smith': 'jsmith' } })).toEqual({
      githubLogins: { 'J. Smith': 'jsmith' },
    });
    expect(() => cleanSettings({ githubLogins: { ' ': 'x' } })).toThrow(
      'bad name',
    );
  });
});

describe('TeamReviewUseCase', () => {
  const build = (latest: { text: string; at: Date } | null) => {
    const ai = {
      digest: jest.fn().mockResolvedValue('Ann: частично…'),
      answer: jest.fn(),
    };
    const reviews = {
      latest: jest.fn().mockResolvedValue(latest),
      save: jest.fn(),
    };
    const useCase = new TeamReviewUseCase(
      { findLatest: jest.fn().mockResolvedValue(snapshot()) } as any,
      ai as any,
      { all: jest.fn().mockResolvedValue([]) } as any,
      reviews,
      {
        current: jest.fn().mockResolvedValue({
          projectBrief: 'b',
          releaseDate: '2026-09-30',
          githubLogins: {},
        }),
      } as any,
    );
    return { useCase, ai, reviews };
  };

  it("reuses today's notes unless asked for fresh ones", async () => {
    const cached = { text: 'old', at: new Date('2026-09-24T07:00:00Z') };
    const { useCase, ai } = build(cached);
    await expect(useCase.review(false, NOW)).resolves.toBe(cached);
    expect(ai.digest).not.toHaveBeenCalled();
  });

  it("asks the model with every person's data and saves the notes", async () => {
    const { useCase, ai, reviews } = build({
      text: 'old',
      at: new Date('2026-09-23T07:00:00Z'),
    });
    await expect(useCase.review(false, NOW)).resolves.toEqual({
      text: 'Ann: частично…',
      at: NOW,
    });
    const question = ai.digest.mock.calls[0][0].question;
    expect(question).toContain('## Ann Lee');
    expect(question).toContain('A-1 [Medium, 10 working days, not in release]');
    expect(question).toContain('Release version: 1.0');
    expect(reviews.save).toHaveBeenCalledWith('Ann: частично…', NOW);
  });
});
