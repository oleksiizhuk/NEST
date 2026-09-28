import { JiraIssueReader } from '@infrastructure/project-manager/jira-issue.reader';
import { assertSaneDates, json, unexpected } from './contract-helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const fixture = (name: string): any =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const search = fixture('jira-search.json');
const done = fixture('jira-done.json');
const changelog = fixture('jira-changelog.json');
const sprints = fixture('jira-board-sprints.json');

// Contract test: the whole Jira read on payloads shaped like the real API
// (dates with offsets, bulk changelog times in epoch ms, sprint names with
// commas, agile pages capped at 50). A shape we did not expect must fail
// here, not on prod.

const NOW = new Date('2026-09-24T10:00:00Z');

const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);

describe('Jira reader contract', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('reads a realistic project end to end with sane numbers and dates', async () => {
    const agileIssue = (i: any) => ({ id: i.id, key: i.key, fields: i.fields });
    global.fetch = jest.fn((url: string, init?: any) => {
      if (url.includes('/rest/agile/1.0/board/3/sprint')) return json(sprints);
      if (url.includes('/rest/agile/1.0/sprint/7/issue')) {
        // The server caps the page size: one issue per page here
        const start = Number(new URL(url).searchParams.get('startAt'));
        return json({
          startAt: start,
          maxResults: 1,
          total: 2,
          issues: search.issues.slice(start, start + 1).map(agileIssue),
        });
      }
      if (url.includes('/rest/agile/1.0/sprint/6/issue'))
        return json({
          startAt: 0,
          maxResults: 50,
          total: 1,
          issues: done.issues.map(agileIssue),
        });
      if (url.endsWith('/changelog/bulkfetch')) return json(changelog);
      if (!url.endsWith('/rest/api/3/search/jql')) return unexpected(url);
      const jql = String(JSON.parse(init.body).jql);
      if (jql.includes('statusCategory = Done')) return json(done);
      if (jql.includes('fixVersion ='))
        return json({
          issues: [...search.issues, ...done.issues],
          isLast: true,
        });
      if (jql.includes('created >='))
        return json({
          issues: [...search.issues, ...done.issues],
          isLast: true,
        });
      return json(search);
    }) as any;

    const result = await new JiraIssueReader(
      env({
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_EMAIL: 'a@b.c',
        JIRA_API_TOKEN: 't',
        PM_JIRA_PROJECTS: 'ORV',
        PM_RELEASE_VERSION: 'MVP 2',
        PM_RELEASE_DATE: '2026-09-30',
        PM_JIRA_BOARD_ID: '3',
      }),
    ).fetch(NOW);
    const d = result.details as any;

    // Nothing fell back to its failure value
    expect(d.stages).not.toBeNull();
    expect(d.flow).not.toBeNull();
    expect(d.hanging).not.toBeNull();
    expect(d.sprints.error).toBeUndefined();
    expect(d.release.error).toBeUndefined();
    assertSaneDates(d);

    // The status date comes from the changelog (epoch ms → ISO)
    const vlad = d.people['Vlad Koropets'].open;
    expect(vlad.find((i: any) => i.key === 'ORV-1')).toMatchObject({
      statusSince: '2026-08-20T08:00:00.000Z',
      stage: 'qa',
    });
    // A sprint whose name holds a comma is still matched (by id)
    expect(d.sprints.rows.map((r: any) => r.name)).toEqual([
      'Sprint 6, Release',
      'Sprint 7',
    ]);
    // The version was put on ORV-1 later than it was created
    expect(d.release.issues.find((i: any) => i.key === 'ORV-1').addedAt).toBe(
      '2026-08-21T08:00:00.000Z',
    );
    // Sub-tasks and a blocker link survive the mapping
    expect(
      d.release.issues.find((i: any) => i.key === 'ORV-2').blockedBy,
    ).toEqual(['ORV-1']);
    expect(result.text).toContain('## Computed metrics');
    // Both pages of the capped sprint were read
    expect(
      d.sprints.rows.find((r: any) => r.name === 'Sprint 7'),
    ).toMatchObject({ committed: 2 });
  });
});
