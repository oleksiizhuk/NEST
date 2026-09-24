import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { IssueFact } from '@application/project-manager/metrics';
import { buildTeam, teamIssues } from '@application/project-manager/team';
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
    expect(texts).toContain('A-1 в работе уже 10 раб. дн.');
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
      { level: 'ok', text: 'Идёт по плану: явных проблем в данных нет.' },
    ]);
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
