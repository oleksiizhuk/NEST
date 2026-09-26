import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { dayLoad } from '@application/project-manager/team-history';
import { teamIssues } from '@application/project-manager/team';
import { TeamReviewUseCase } from '@application/project-manager/use-cases/team-review.use-case';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';

const NOW = new Date('2026-09-24T10:00:00Z');

const snap = (at: string) =>
  new ProjectSnapshot('s', new Date(at), [
    {
      source: 'issues',
      ok: true,
      fetchedAt: new Date(at),
      text: '',
      error: null,
      details: teamIssues(
        [
          {
            key: 'A-1',
            type: 'Story',
            status: 'In Progress',
            category: 'indeterminate',
            priority: null,
            assignee: 'Ann',
            fixVersions: [],
            created: null,
            doneAt: null,
            statusSince: null,
            due: null,
          },
          {
            key: 'A-2',
            type: 'Story',
            status: 'To Do',
            category: 'new',
            priority: null,
            assignee: 'Ann',
            fixVersions: [],
            created: null,
            doneAt: null,
            statusSince: null,
            due: null,
          },
        ],
        [],
        new Date(at),
        null,
        false,
      ) as any,
    },
  ]);

describe('team history', () => {
  it('turns a snapshot into one day of per-person load', () => {
    expect(dayLoad(snap('2026-09-24T05:00:00Z'))).toEqual({
      day: '2026-09-24',
      people: { Ann: { inProgress: 1, queue: 1, closed14: 0 } },
    });
  });

  it('fills missing days once from stored snapshots', async () => {
    const history = {
      since: jest.fn().mockResolvedValue([
        {
          day: '2026-09-24',
          people: { Ann: { inProgress: 2, queue: 0, closed14: 1 } },
        },
      ]),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const snapshots = {
      findLatestBefore: jest.fn(async (before: Date) =>
        before.toISOString().startsWith('2026-09-23')
          ? snap('2026-09-22T05:00:00Z')
          : null,
      ),
    };
    const useCase = new TeamReviewUseCase(
      snapshots as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      history,
    );
    const h = await useCase.teamHistory(NOW, 5);
    expect(h.days).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
    ]);
    expect(h.people).toEqual([
      {
        name: 'Ann',
        days: [
          null,
          null,
          { inProgress: 1, queue: 1, closed14: 0 },
          null,
          { inProgress: 2, queue: 0, closed14: 1 },
        ],
      },
    ]);
    expect(history.save).toHaveBeenCalledTimes(1);
  });

  it('saves the day at every refresh without failing it', async () => {
    const history = {
      since: jest.fn(),
      save: jest.fn().mockRejectedValue(new Error('down')),
    };
    const saved = snap('2026-09-24T05:00:00Z');
    const useCase = new RefreshProjectSnapshotUseCase(
      [],
      {
        findLatest: jest.fn().mockResolvedValue(null),
        findLatestBefore: jest.fn().mockResolvedValue(null),
        save: jest.fn().mockResolvedValue(saved),
      } as any,
      history,
    );
    await expect(useCase.execute(NOW)).resolves.toBe(saved);
    expect(history.save).toHaveBeenCalledWith(
      expect.objectContaining({ day: '2026-09-24' }),
    );
  });
});
