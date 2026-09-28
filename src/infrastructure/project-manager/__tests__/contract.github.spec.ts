import { readFileSync } from 'fs';
import { join } from 'path';
import { GitHubActivityReader } from '@infrastructure/project-manager/github-activity.reader';
import { assertSaneDates, json, unexpected } from './contract-helpers';

// Contract test: the whole GitHub read on payloads shaped like the real API
// (REST pulls and runs, GraphQL with bots, team review requests, promotion
// branches, pageInfo)

const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const NOW = new Date('2026-09-24T10:00:00Z');
describe('GitHub reader contract', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('reads a realistic repo end to end', async () => {
    global.fetch = jest.fn((url: string, init?: any) => {
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(init.body);
        if (!String(body.query).includes('pageInfo'))
          return json(fixture('github-graphql-reviews.json'));
        // Like GitHub: the states filter decides what comes back
        const load = fixture('github-graphql-load.json');
        const merged = body.variables.states.includes('MERGED');
        load.data.repository.pullRequests.nodes =
          load.data.repository.pullRequests.nodes
            .filter((n: any) => Boolean(n.mergedAt) === merged)
            // #10 was still open when the OPEN query ran, merged by the
            // MERGED query: the merged copy must win
            .concat(
              merged
                ? []
                : [
                    {
                      ...load.data.repository.pullRequests.nodes.find(
                        (n: any) => n.number === 10,
                      ),
                      mergedAt: null,
                    },
                  ],
            );
        return json(load);
      }
      if (url.includes('/pulls?state=open'))
        return json(fixture('github-pulls-open.json'));
      if (url.includes('/pulls?state=closed'))
        return json(fixture('github-pulls-closed.json'));
      if (url.includes('/actions/runs'))
        return json(fixture('github-runs.json'));
      return unexpected(url);
    }) as any;
    const result = await new GitHubActivityReader({
      get: (k: string) =>
        ((
          {
            PM_GITHUB_TOKEN: 't',
            PM_GITHUB_ORG: 'org',
            PM_GITHUB_REPOS: 'api',
          } as Record<string, string>
        )[k]),
    } as any).fetch(NOW);
    const d = result.details as any;
    assertSaneDates(d);
    expect(result.text).not.toContain('could not read');
    // The promotion PR dev → staging is not review work
    expect(d.reviews.waiting.map((w: any) => w.number)).toEqual([12]);
    expect(d.reviews.size).toMatchObject({ big: 0 });
    // A bot's comment is not a review; a team request is kept
    expect(d.reviews.waiting[0].requested).toEqual([
      'eugene-t',
      'team:backend',
    ]);
    expect(
      d.reviews.reviewers.find((r: any) => r.login === 'vlad-k'),
    ).toMatchObject({
      reviewed: 1,
    });
    expect(d.authors['vlad-k'].open.map((p: any) => p.number)).toEqual([
      12, 13,
    ]);
    expect(d.authors['eugene-t'].merged14).toEqual(['api#10 ORV-10 login']);
    // #10 seen open and merged counts once, as merged
    expect(d.reviews.merged).toBe(1);
  });
});
