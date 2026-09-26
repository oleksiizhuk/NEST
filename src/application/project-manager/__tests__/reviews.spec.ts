import { PrFact, reviewLoad } from '@application/project-manager/reviews';

const NOW = new Date('2026-09-24T10:00:00Z');

const pr = (number: number, over: Partial<PrFact>): PrFact => ({
  repo: 'api',
  number,
  author: 'ann',
  draft: false,
  readyAt: '2026-09-20T10:00:00Z',
  mergedAt: null,
  lines: 100,
  files: 3,
  reviews: [],
  requested: [],
  ...over,
});

describe('reviewLoad', () => {
  const prs = [
    pr(1, {
      mergedAt: '2026-09-21T10:00:00Z',
      lines: 900,
      reviews: [
        {
          login: 'bob',
          at: '2026-09-20T14:00:00Z',
          state: 'CHANGES_REQUESTED',
        },
        {
          login: 'bob',
          at: '2026-09-20T18:00:00Z',
          state: 'CHANGES_REQUESTED',
        },
        { login: 'bob', at: '2026-09-21T09:00:00Z', state: 'APPROVED' },
      ],
    }),
    pr(2, {
      mergedAt: '2026-09-22T10:00:00Z',
      author: 'cid',
      reviews: [
        { login: 'bob', at: '2026-09-22T12:00:00Z', state: 'APPROVED' },
        { login: 'cid', at: '2026-09-22T09:00:00Z', state: 'COMMENTED' },
      ],
      readyAt: '2026-09-22T10:00:00Z',
    }),
    pr(3, { mergedAt: '2026-09-23T10:00:00Z', author: 'cid' }),
    pr(4, {
      author: 'dependabot[bot]',
      mergedAt: '2026-09-23T10:00:00Z',
    }),
    pr(5, { requested: ['bob', 'eve'], readyAt: '2026-09-23T10:00:00Z' }),
    pr(6, { draft: true, requested: ['eve'] }),
    pr(7, { mergedAt: '2026-06-01T10:00:00Z', lines: 5000 }),
  ];

  it('counts who reviews, who waits and how big the work is', () => {
    const r = reviewLoad(prs, NOW);
    expect(r.merged).toBe(3);
    expect(r.reviewers).toEqual([
      { login: 'bob', pending: 1, reviewed: 2, share: 1 },
      { login: 'eve', pending: 1, reviewed: 0, share: 0 },
    ]);
    // Ann's #1 waited 4 h, Cid's #2 2 h, and open #5 has waited 24 h so
    // far; own comments and bots do not count
    expect(r.firstReview).toEqual({ p50: 4, p85: 24 });
    expect(r.authors.find((a) => a.login === 'cid')).toEqual({
      login: 'cid',
      merged: 2,
      waitHours: 2,
    });
    expect(r.size).toEqual({ medianLines: 100, big: 1, bigShare: 0.33 });
    expect(r.noReview).toEqual([{ repo: 'api', number: 3, author: 'cid' }]);
    expect(r.manyRounds).toEqual([{ repo: 'api', number: 1, rounds: 2 }]);
    expect(r.waiting).toEqual([
      {
        repo: 'api',
        number: 5,
        author: 'ann',
        hours: 24,
        requested: ['bob', 'eve'],
      },
    ]);
    // Two reviews are too few to call it a concentration
    expect(r.concentration).toBeNull();
  });

  it('counts a re-requested reviewer as pending and rounds per reviewer', () => {
    const r = reviewLoad(
      [
        pr(8, {
          requested: ['bob', 'team:backend'],
          reviews: [
            {
              login: 'bob',
              at: '2026-09-21T10:00:00Z',
              state: 'CHANGES_REQUESTED',
            },
            {
              login: 'eve',
              at: '2026-09-21T11:00:00Z',
              state: 'CHANGES_REQUESTED',
            },
          ],
        }),
      ],
      NOW,
    );
    expect(r.reviewers.find((x) => x.login === 'bob')?.pending).toBe(1);
    expect(r.reviewers.find((x) => x.login === 'team:backend')?.pending).toBe(
      1,
    );
    // Two people asking once each is one round
    expect(r.manyRounds).toEqual([]);
  });
});
