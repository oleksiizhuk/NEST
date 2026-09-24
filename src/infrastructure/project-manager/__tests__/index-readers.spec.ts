import {
  ConfluenceIndexReader,
  FigmaIndexReader,
} from '@infrastructure/project-manager/index-readers';

const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);
const json = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  });

describe('index readers', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('leaves a Confluence page out when its parent cannot be checked', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/spaces?keys=')) return json({ results: [{ id: 7 }] });
      if (url.includes('/spaces/7/pages'))
        return json({
          results: [
            {
              id: '1',
              title: 'Checkout spec',
              parentId: null,
              body: { storage: { value: '<p>a</p>' } },
            },
            {
              id: '2',
              title: 'Staging env',
              parentId: '99',
              body: { storage: { value: '<p>secret-ish</p>' } },
            },
          ],
          _links: {},
        });
      // The parent (a folder, or rate limited) cannot be read
      return Promise.resolve({ ok: false, status: 404 });
    }) as any;
    const reader = new ConfluenceIndexReader(
      env({
        JIRA_BASE_URL: 'https://x.atlassian.net',
        JIRA_EMAIL: 'a@b.c',
        JIRA_API_TOKEN: 't',
        PM_CONFLUENCE_SPACES: 'ORV',
      }),
    );
    const { docs, next } = await reader.page(null);
    expect(docs.map((d) => d.key)).toEqual(['1']);
    expect(next).toBeNull();
  });

  it('fails the Figma step instead of indexing no comments', async () => {
    global.fetch = jest.fn((url: string) =>
      url.endsWith('/comments')
        ? Promise.resolve({ ok: false, status: 429 })
        : json({ name: 'App', document: { children: [] } }),
    ) as any;
    const reader = new FigmaIndexReader(
      env({ PM_FIGMA_TOKEN: 't', PM_FIGMA_FILE_KEYS: 'abcdefghij12' }),
    );
    await expect(reader.page(null)).rejects.toThrow('429');
  });
});
