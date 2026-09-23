import { adfToText } from '@infrastructure/project-manager/adf-to-text';
import {
  renderNode,
  figmaLink,
  FigmaDesignHost,
} from '@infrastructure/project-manager/figma-design.host';
import { JiraIssueDetails } from '@infrastructure/project-manager/jira-issue-details';

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
