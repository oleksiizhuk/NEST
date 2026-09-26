import {
  formatIssue,
  JiraIssueReader,
  toFact,
} from '@infrastructure/project-manager/jira-issue.reader';
import { GitHubActivityReader } from '@infrastructure/project-manager/github-activity.reader';
import { ConfluencePageReader } from '@infrastructure/project-manager/confluence-page.reader';
import { storageToText } from '@infrastructure/project-manager/storage-to-text';
import { pmConfig } from '@infrastructure/project-manager/pm.config';

const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);
const json = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  });

const firstFields = (mock: jest.Mock): string[] =>
  JSON.parse(mock.mock.calls[0][1].body).fields;

describe('Jira reader', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('formats an issue as one line with owner, parent and blockers', () => {
    expect(
      formatIssue({
        key: 'ABC-242',
        fields: {
          summary: '[QA] Release regression',
          status: { name: 'Backlog' },
          issuetype: { name: 'Sub-task' },
          priority: { name: 'Normal' },
          assignee: null,
          parent: { key: 'ABC-212' },
          issuelinks: [
            {
              type: { inward: 'is blocked by' },
              inwardIssue: {
                key: 'ABC-236',
                fields: { status: { name: 'In Review' } },
              },
            },
          ],
          created: '2026-09-21T10:00:00.000+0000',
          updated: '2026-09-22T10:00:00.000+0000',
        },
      }),
    ).toBe(
      'ABC-242 | Backlog | Sub-task | Normal | UNASSIGNED | parent ABC-212 | created 09-21 | updated 09-22 | is blocked by ABC-236(In Review) | [QA] Release regression',
    );
  });

  it('counts a blocking link only while its issue is not done, by category', () => {
    const link = (key: string, cat: string, name: string) => ({
      type: { inward: 'is blocked by' },
      inwardIssue: {
        key,
        fields: { status: { name, statusCategory: { key: cat } } },
      },
    });
    const fact = toFact({
      key: 'ABC-1',
      fields: {
        status: { name: 'Open' },
        issuelinks: [
          link('ABC-2', 'done', 'Готово'),
          link('ABC-3', 'indeterminate', 'В работе'),
        ],
      },
    });
    expect(fact.blockedBy).toEqual(['ABC-3']);
  });

  it('adds fixVersion, component and active sprint to the line', () => {
    const line = formatIssue({
      key: 'ABC-7',
      fields: {
        summary: 'Checkout',
        status: { name: 'In Progress' },
        fixVersions: [{ name: '1.0' }],
        components: [{ name: 'mobile' }],
        customfield_10020: [
          { name: 'Sprint 3', state: 'closed' },
          { name: 'Sprint 4', state: 'active' },
        ],
      },
    });
    expect(line).toContain('| fix 1.0 | comp mobile | sprint Sprint 4 |');
  });

  it('is off until projects are configured, then pages with nextPageToken', async () => {
    expect(
      new JiraIssueReader(
        env({ JIRA_BASE_URL: 'https://x.atlassian.net' }),
      ).isConfigured(),
    ).toBe(false);

    const issue = (key: string) => ({
      key,
      fields: { summary: key, status: { name: 'Open' } },
    });
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(
        json({ issues: [issue('ABC-1')], nextPageToken: 't2', isLast: false }),
      )
      .mockReturnValueOnce(json({ issues: [issue('ABC-2')], isLast: true }))
      .mockReturnValueOnce(json({ issues: [issue('ABC-3')], isLast: true }))
      // Weekly history: closed, then created, with light fields only
      .mockReturnValueOnce(json({ issues: [issue('ABC-3')], isLast: true }))
      .mockReturnValueOnce(json({ issues: [issue('ABC-9')], isLast: true }));
    global.fetch = fetchMock as any;

    const reader = new JiraIssueReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net/',
        JIRA_EMAIL: 'a@b.c',
        JIRA_API_TOKEN: 't',
        PM_JIRA_PROJECTS: 'ABC, XYZ',
      }),
    );
    const { text, metrics, details } = await reader.fetch();

    expect(text.startsWith('## Computed metrics')).toBe(true);
    const history = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(history.jql).toContain(
      '(resolved >= -84d OR statusCategoryChangedDate >= -84d)',
    );
    expect(history.fields).not.toContain('summary');
    expect(JSON.parse(fetchMock.mock.calls[4][1].body).jql).toContain(
      'created >= -84d',
    );
    expect((details as any).flow.weeks).toHaveLength(12);
    expect(text).not.toContain('ABC-9');
    expect(metrics).toMatchObject({ open: 2, done14: 0 });
    expect(text).toContain('Open work items: 2 — to do 2, in progress 0.');
    expect(text).toContain('## Open issues: 2');
    expect(firstFields(fetchMock)).toEqual(
      expect.arrayContaining(['fixVersions', 'customfield_10020']),
    );
    expect(text).toContain('## Done in the last 14 days: 1');
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.jql).toContain(
      'project in (ABC, XYZ) AND statusCategory != Done',
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).nextPageToken).toBe(
      't2',
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://x.atlassian.net/rest/api/3/search/jql',
    );
  });
});

describe('Jira reader status history', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('reads the bulk changelog and uses the last status change', async () => {
    const open = {
      id: '101',
      key: 'ABC-1',
      fields: {
        summary: 'Checkout',
        status: { name: 'In Review', statusCategory: { key: 'indeterminate' } },
        assignee: { displayName: 'Ann' },
        issuetype: { name: 'Story' },
        created: '2026-09-01T09:00:00.000+0000',
        statuscategorychangedate: '2026-09-02T09:00:00.000+0000',
      },
    };
    const fetchMock = jest.fn((url: string, init: any) => {
      if (url.endsWith('/changelog/bulkfetch'))
        return json({
          issueChangeLogs: [
            {
              issueId: '101',
              changeHistories: [
                {
                  created: '2026-09-02T09:00:00.000+0000',
                  items: [
                    {
                      fieldId: 'status',
                      fromString: 'To Do',
                      toString: 'In Progress',
                    },
                  ],
                },
                {
                  created: '2026-09-21T09:00:00.000+0000',
                  items: [
                    {
                      fieldId: 'status',
                      fromString: 'In Progress',
                      toString: 'In Review',
                    },
                    // Jira may leave out "toString" on an unassign
                    { fieldId: 'assignee', fromString: 'Ann' },
                  ],
                },
              ],
            },
          ],
        });
      const jql = JSON.parse(init.body).jql as string;
      return json({
        issues: jql.includes('statusCategory != Done') ? [open] : [],
        isLast: true,
      });
    });
    global.fetch = fetchMock as any;
    const { details } = await new JiraIssueReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        PM_JIRA_PROJECTS: 'ABC',
        PM_STATUS_MAP: 'In Review=review',
      }),
    ).fetch(new Date('2026-09-24T10:00:00Z'));
    const bulk = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/changelog/bulkfetch'),
    );
    expect(JSON.parse((bulk as any)[1].body)).toMatchObject({
      issueIdsOrKeys: ['ABC-1'],
      fieldIds: ['status', 'assignee'],
    });
    const d = details as any;
    expect(d.people.Ann.open[0]).toMatchObject({
      statusSince: '2026-09-21T09:00:00.000+0000',
      stage: 'review',
    });
    expect(JSON.stringify(d.stages.handoffs)).not.toContain('function');
    expect(d.stages.aging[0]).toMatchObject({
      key: 'ABC-1',
      stage: 'review',
      stageDays: 3,
    });
  });
});

describe('Jira reader release', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('keeps every release ticket with when the version was put on it', async () => {
    const ticket = {
      id: '7',
      key: 'ABC-7',
      fields: {
        summary: 'Pay',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        issuetype: { name: 'Story' },
        reporter: { displayName: 'Client' },
        created: '2026-09-01T09:00:00.000+0000',
        resolutiondate: '2026-09-20T09:00:00.000+0000',
        fixVersions: [{ name: 'MVP "2"' }],
      },
    };
    const fetchMock = jest.fn((url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (url.endsWith('/changelog/bulkfetch'))
        return json({
          issueChangeLogs: body.fieldIds.includes('fixVersions')
            ? [
                {
                  issueId: '7',
                  changeHistories: [
                    {
                      created: '2026-09-10T09:00:00.000+0000',
                      items: [{ fieldId: 'fixVersions', toString: 'MVP "2"' }],
                    },
                  ],
                },
              ]
            : [],
        });
      return json({
        issues: String(body.jql).includes('fixVersion =') ? [ticket] : [],
        isLast: true,
      });
    });
    global.fetch = fetchMock as any;
    const { details } = await new JiraIssueReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        PM_JIRA_PROJECTS: 'ABC',
        PM_RELEASE_VERSION: 'MVP "2"',
      }),
    ).fetch(new Date('2026-09-24T10:00:00Z'));
    const jql = fetchMock.mock.calls
      .map(([, init]) => JSON.parse((init as any).body).jql)
      .find((q) => String(q).includes('fixVersion ='));
    expect(jql).toBe(
      'project in (ABC) AND fixVersion = "MVP \\"2\\"" ORDER BY created ASC',
    );
    expect((details as any).release.issues[0]).toMatchObject({
      key: 'ABC-7',
      reporter: 'Client',
      doneAt: '2026-09-20T09:00:00.000+0000',
      addedAt: '2026-09-10T09:00:00.000+0000',
    });
  });
});

describe('Jira reader release errors', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('reports a failed release read instead of "not set"', async () => {
    global.fetch = jest.fn((url: string, init: any) => {
      const jql = String(JSON.parse(init.body).jql ?? '');
      if (jql.includes('fixVersion ='))
        return Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('rate limited'),
          headers: new Headers(),
        });
      return json({ issues: [], isLast: true });
    }) as any;
    const { details } = await new JiraIssueReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        PM_JIRA_PROJECTS: 'ABC',
        PM_RELEASE_VERSION: '1.0',
      }),
    ).fetch(new Date('2026-09-24T10:00:00Z'));
    expect((details as any).release).toMatchObject({
      version: '1.0',
      issues: [],
      error: expect.any(String),
    });
  });
});

describe('Jira reader caps', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('keeps no trend numbers when a list hit its cap', async () => {
    let n = 0;
    global.fetch = jest.fn(() =>
      json({
        issues: Array.from({ length: 100 }, () => ({
          key: `ABC-${++n}`,
          fields: { status: { name: 'Open' } },
        })),
        nextPageToken: 'next',
        isLast: false,
      }),
    ) as any;
    const result = await new JiraIssueReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        PM_JIRA_PROJECTS: 'ABC',
      }),
    ).fetch();
    expect(result.text).toContain('(capped at 400)');
    expect(result.metrics).toBeUndefined();
  });
});

describe('Confluence reader', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('turns storage format into compact text with checkboxes and table rows', () => {
    const text = storageToText(
      '<h2>Release 1</h2><table><tr><td>Profile</td><td><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>DELETE on prod BLOCKER</ac:task-body></ac:task></td></tr></table><p>Checked on <time datetime="2026-09-23" /></p>',
      1000,
    );
    expect(text).toContain('## Release 1');
    expect(text).toContain('| Profile | [ ] DELETE on prod BLOCKER');
    expect(text).toContain('Checked on 2026-09-23');
  });

  it('keeps ticket keys, page titles and design links', () => {
    const text = storageToText(
      '<p>See <ac:structured-macro ac:name="jira"><ac:parameter ac:name="server">X</ac:parameter><ac:parameter ac:name="key">ABC-12</ac:parameter></ac:structured-macro> and <a href="https://x.atlassian.net/browse/ABC-13">ticket</a>, design <a href="https://www.figma.com/design/KEY?node-id=1-2&amp;t=z">Checkout</a>, <ac:link><ri:page ri:content-title="Release plan" /></ac:link>, <ac:link><ri:user ri:account-id="123" /></ac:link> <a href="mailto:x@y">mail</a></p>',
      1000,
    );
    expect(text).toContain('ABC-12');
    expect(text).toContain('ticket ABC-13');
    expect(text).toContain(
      'Checkout (https://www.figma.com/design/KEY?node-id=1-2&t=z)',
    );
    expect(text).toContain('[page: Release plan]');
    expect(text).toContain('@someone');
    expect(text).toContain('mail');
    expect(text).not.toContain('mailto');
    expect(text).not.toContain('server');
  });

  it('keeps going when one page cannot be read', async () => {
    global.fetch = jest
      .fn()
      .mockReturnValueOnce(
        json({
          id: '1',
          title: 'Release 1',
          version: { number: 5, createdAt: '2026-09-23T09:59:00Z' },
          body: { storage: { value: '<p>ok</p>' } },
        }),
      )
      .mockReturnValueOnce(Promise.resolve({ ok: false, status: 404 })) as any;
    const reader = new ConfluencePageReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        PM_CONFLUENCE_PAGE_IDS: '1,2,not-a-page',
      }),
    );
    const text = await reader.fetch();
    expect(text).toContain('## Release 1 (page 1, v5, edited 2026-09-23)\nok');
    expect(text).toContain(
      '## page 2: could not read (x.atlassian.net responded 404)',
    );
  });
});

describe('GitHub reader', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('is off without a token', () => {
    expect(
      new GitHubActivityReader(
        env({ PM_GITHUB_ORG: 'o', PM_GITHUB_REPOS: 'r' }),
      ).isConfigured(),
    ).toBe(false);
  });

  it('separates work PRs from branch promotions and reports drift', async () => {
    const now = new Date('2026-09-23T06:00:00Z');
    const pr = (n: number, head: string, merged: string | null) => ({
      number: n,
      title: `PR ${n}`,
      user: { login: 'dev' },
      created_at: '2026-09-20T00:00:00Z',
      updated_at: '2026-09-22T00:00:00Z',
      merged_at: merged,
      head: { ref: head },
      base: { ref: 'main' },
    });
    global.fetch = jest.fn((url: string) => {
      if (url.includes('state=open'))
        return json([pr(9, 'feat/ABC-1-x', null)]);
      if (url.includes('state=closed'))
        return json([
          pr(8, 'feat/ABC-2-y', '2026-09-22T00:00:00Z'),
          pr(7, 'staging', '2026-09-21T00:00:00Z'),
        ]);
      if (url.includes('/actions/runs'))
        return json({
          workflow_runs: [
            {
              name: 'Deploy',
              head_branch: 'main',
              conclusion: 'failure',
              created_at: '2026-09-22T00:00:00Z',
            },
          ],
        });
      if (url.endsWith('/graphql'))
        return json({
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 9,
                    reviewDecision: null,
                    author: { login: 'dev' },
                    // The author's own reply and a bot do not count
                    reviews: {
                      nodes: [
                        { author: { __typename: 'User', login: 'dev' } },
                        { author: { __typename: 'Bot', login: 'coderabbit' } },
                      ],
                    },
                    timelineItems: { nodes: [] },
                  },
                ],
              },
            },
          },
        });
      if (url.includes('/compare/'))
        return json({ ahead_by: 435, behind_by: 0, status: 'ahead' });
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;

    const { text, metrics } = await new GitHubActivityReader(
      env({
        PM_GITHUB_TOKEN: 't',
        PM_GITHUB_ORG: 'o',
        PM_GITHUB_REPOS: 'api',
        PM_GITHUB_COMPARES: 'api:main...staging',
      }),
    ).fetch(now);

    expect(text).toContain(
      '#9 | dev | feat/ABC-1-x → main | open 3d | no review yet | PR 9',
    );
    expect(text).toContain(
      'Waiting for a first review more than 2 working days: api#9 dev 3d.',
    );
    expect(text).toContain(
      'Red pipelines: api:Deploy@main since 2026-09-22 (1 working days).',
    );
    expect(metrics).toMatchObject({
      openPrs: 1,
      waitingReview: 1,
      redPipelines: 1,
    });
    expect(text).toContain('1 work PRs (dev 1)');
    expect(text).toContain('Branch promotions: staging→main #7 09-21');
    expect(text).toContain('Deploy@main: failure (09-22)');
    expect(text).toContain('api: staging is 435 commits ahead of main');
  });
});

describe('pmConfig', () => {
  it('reads chat ids, resolving "owner" to TELEGRAM_OWNER_ID', () => {
    const config = pmConfig(
      env({
        TELEGRAM_PM_CHAT_IDS: 'owner, -1001234, junk',
        TELEGRAM_OWNER_ID: '55',
        PM_RELEASE_DATE: '2026-09-30',
        PM_PROJECT_BRIEF: 'line1\\nline2',
        PM_DM_USERNAMES: '@Dmytro_AA, annazhukkkk,bad name',
      }),
    );
    expect(config.chatIds).toEqual([55, -1001234]);
    expect(config.releaseDate).toBe('2026-09-30');
    expect(config.projectBrief).toBe('line1\nline2');
    expect(config.digestChatId).toBeNull();
    expect(config.maxSnapshotAgeHours).toBe(30);
    expect(config.dmUsernames).toEqual(['dmytro_aa', 'annazhukkkk']);
  });
});
