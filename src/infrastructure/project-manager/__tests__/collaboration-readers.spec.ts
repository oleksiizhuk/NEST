import { adfToText } from '@infrastructure/project-manager/adf-to-text';
import {
  renderNode,
  figmaLink,
  FigmaDesignHost,
} from '@infrastructure/project-manager/figma-design.host';
import { JiraIssueDetails } from '@infrastructure/project-manager/jira-issue-details';
import { ConfluenceCommentsReader } from '@infrastructure/project-manager/confluence-comments.reader';

const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);
const json = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  });

describe('adfToText', () => {
  it('keeps text, mentions, links and list items', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { text: '@Ira' } },
            { type: 'text', text: ' please check ' },
            {
              type: 'text',
              text: 'spec',
              marks: [{ type: 'link', attrs: { href: 'https://x/spec' } }],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'AC one' }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(adfToText(doc)).toBe(
      '@Ira please check spec (https://x/spec)\n- AC one',
    );
  });
});

describe('Figma design host', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('renders a node compactly with colours, text and layout', () => {
    const lines = renderNode(
      {
        type: 'FRAME',
        name: 'Home',
        id: '1:2',
        absoluteBoundingBox: { width: 375, height: 812 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 0.5, b: 0 } }],
        layoutMode: 'VERTICAL',
        itemSpacing: 8,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        children: [
          {
            type: 'TEXT',
            name: 'Title',
            id: '1:3',
            characters: 'Welcome',
            style: {
              fontFamily: 'Readex Pro',
              fontWeight: 600,
              fontSize: 24,
              lineHeightPx: 32,
            },
          },
          { type: 'INSTANCE', name: 'Button', id: '1:4', componentId: 'c1' },
          { type: 'RECTANGLE', name: 'hidden', id: '1:5', visible: false },
        ],
      },
      { c1: { name: 'Button/Primary' } },
    );
    expect(lines[0]).toBe(
      'FRAME "Home" [1:2] · 375×812 · fill #FF8000 · auto-layout vertical gap 8 pad 16/16/16/16',
    );
    expect(lines[1]).toContain('"Welcome" · Readex Pro 600 24px lh 32');
    expect(lines[2]).toContain('instance of Button/Primary');
    expect(lines).toHaveLength(3);
  });

  it('builds deep links with a dash in the node id', () => {
    expect(figmaLink('KEY1234567', '12:34')).toBe(
      'https://www.figma.com/design/KEY1234567?node-id=12-34',
    );
  });

  it('refuses unknown files and bad node ids', async () => {
    const host = new FigmaDesignHost(
      env({ PM_FIGMA_TOKEN: 't', PM_FIGMA_FILE_KEYS: 'KEY1234567' }),
    );
    await expect(host.getNodes('OTHER12345', ['1:2'], 2)).rejects.toThrow(
      /Unknown design file/,
    );
    await expect(host.getNodes('', ['x'], 2)).rejects.toThrow(/node ids/);
  });

  it('groups comment replies under their thread', async () => {
    global.fetch = jest.fn(() =>
      json({
        comments: [
          {
            id: 'c1',
            message: 'Is this final?',
            created_at: new Date().toISOString(),
            resolved_at: null,
            user: { handle: 'Faisal' },
            client_meta: { node_id: '1:2' },
          },
          {
            id: 'c2',
            parent_id: 'c1',
            message: 'Yes',
            created_at: new Date().toISOString(),
            user: { handle: 'Eugene' },
          },
        ],
      }),
    ) as any;
    const [remark] = await new FigmaDesignHost(
      env({ PM_FIGMA_TOKEN: 't', PM_FIGMA_FILE_KEYS: 'KEY1234567' }),
    ).recentComments(14);
    expect(remark).toMatchObject({
      author: 'Faisal',
      where: 'node 1:2',
      replies: [{ author: 'Eugene' }],
    });
  });
});

describe('JiraIssueDetails', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));
  const config = env({
    JIRA_BASE_URL: 'https://x.atlassian.net',
    JIRA_EMAIL: 'a',
    JIRA_API_TOKEN: 't',
    PM_JIRA_PROJECTS: 'ABC',
  });

  it('reads only issues of the configured projects', async () => {
    await expect(
      new JiraIssueDetails(config).getIssue('ZZZ-1'),
    ).rejects.toThrow(/Only issues of ABC/);
  });

  it('renders fields, description, changes and comments', async () => {
    global.fetch = jest.fn((url: string) =>
      url.includes('/comment')
        ? json({
            total: 1,
            comments: [
              {
                created: '2026-09-22T10:00:00.000+0000',
                author: { displayName: 'Faisal' },
                body: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Any update?' }],
                    },
                  ],
                },
              },
            ],
          })
        : json({
            fields: {
              summary: 'Release',
              issuetype: { name: 'Story' },
              status: { name: 'In Progress' },
              assignee: { displayName: 'Oleksii' },
              reporter: { displayName: 'Anna' },
              description: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'AC: build on prod' }],
                  },
                ],
              },
              created: '2026-09-20T10:00:00.000+0000',
              updated: '2026-09-22T10:00:00.000+0000',
            },
            changelog: {
              histories: [
                {
                  created: '2026-09-21T10:00:00.000+0000',
                  author: { displayName: 'Oleksii' },
                  items: [
                    {
                      field: 'status',
                      fromString: 'Backlog',
                      toString: 'In Progress',
                    },
                  ],
                },
              ],
            },
          }),
    ) as any;
    const text = await new JiraIssueDetails(config).getIssue('abc-212');
    expect(text).toContain('ABC-212 · Story · In Progress');
    expect(text).toContain('AC: build on prod');
    expect(text).toContain('09-21 Oleksii: status Backlog → In Progress');
    expect(text).toContain('09-22 Faisal: Any update?');
  });
});

describe('JiraIssueDetails changelog', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('fetches the newest changelog page when the ticket has more than the expand returns', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn((url: string) => {
      urls.push(url);
      if (url.includes('/comment')) return json({ total: 0, comments: [] });
      if (url.includes('/changelog?')) {
        return json({
          values: [
            {
              created: '2026-09-22T10:00:00.000+0000',
              author: { displayName: 'Ira' },
              items: [
                {
                  field: 'status',
                  fromString: 'On DEV',
                  toString: 'Tested On Stage',
                },
              ],
            },
          ],
        });
      }
      return json({
        fields: { summary: 's', status: { name: 'x' } },
        changelog: {
          total: 150,
          histories: [
            {
              created: '2026-07-01T10:00:00.000+0000',
              author: { displayName: 'Old' },
              items: [{ field: 'status', fromString: 'A', toString: 'B' }],
            },
          ],
        },
      });
    }) as any;
    const text = await new JiraIssueDetails(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        PM_JIRA_PROJECTS: 'ABC',
      }),
    ).getIssue('ABC-1');
    expect(
      urls.some((u) => u.includes('/changelog?startAt=100&maxResults=50')),
    ).toBe(true);
    expect(text).toContain('09-22 Ira: status On DEV → Tested On Stage');
    expect(text).not.toContain('Old:');
  });
});

describe('ConfluenceCommentsReader', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('skips old comments before fetching replies, reads in parallel, and dates an edited comment by version 1', async () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    let inFlight = 0;
    let maxInFlight = 0;
    const childCalls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (url.includes('/footer-comments?')) {
        return json({
          results: [
            {
              id: 'old',
              version: { number: 1, createdAt: old, authorId: 'a1' },
              body: { storage: { value: '<p>Old?</p>' } },
            },
            {
              id: 'e1',
              version: {
                number: 2,
                createdAt: new Date().toISOString(),
                authorId: 'editor',
              },
              body: { storage: { value: '<p>Which domain?</p>' } },
            },
            ...Array.from({ length: 5 }, (_, i) => ({
              id: `n${i}`,
              version: { number: 1, createdAt: recent, authorId: 'a1' },
              body: { storage: { value: '<p>Q?</p>' } },
            })),
          ],
        });
      }
      if (url.includes('/inline-comments?')) return json({ results: [] });
      if (url.includes('/versions/1'))
        return json({ authorId: 'faisal', createdAt: recent });
      if (url.includes('/children')) {
        childCalls.push(url);
        return json({ results: [] });
      }
      if (url.includes('/rest/api/user'))
        return json({
          displayName: url.includes('faisal') ? 'Faisal' : 'Someone',
        });
      return json({ title: 'Share', _links: { webui: '/spaces/X/pages/1' } });
    }) as any;

    const remarks = await new ConfluenceCommentsReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        PM_CONFLUENCE_PAGE_IDS: '1',
      }),
    ).recentComments(30);

    expect(childCalls.some((u) => u.includes('/old/'))).toBe(false);
    expect(remarks).toHaveLength(6);
    const edited = remarks.find((r) => r.text === 'Which domain?');
    expect(edited?.author).toBe('Faisal');
    expect(edited?.createdAt.toISOString()).toBe(recent);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
