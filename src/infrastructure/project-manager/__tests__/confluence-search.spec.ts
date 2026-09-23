import { ConfluenceSearch } from '@infrastructure/project-manager/confluence-search';

const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);
const json = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  });

const CONFIG = {
  JIRA_BASE_URL: 'https://x.atlassian.net',
  JIRA_EMAIL: 'a@b.c',
  JIRA_API_TOKEN: 't',
  PM_CONFLUENCE_SPACES: 'ORV',
  PM_CONFLUENCE_PAGE_IDS: '500',
  PM_CONFLUENCE_EXCLUDE_PAGE_IDS: '666',
};

describe('ConfluenceSearch', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('is off without allowed spaces', () => {
    expect(
      new ConfluenceSearch(
        env({ ...CONFIG, PM_CONFLUENCE_SPACES: '' }),
      ).isConfigured(),
    ).toBe(false);
  });

  it('searches only allowed spaces and never lists access pages', async () => {
    const fetchMock = jest.fn(() =>
      json({
        results: [
          {
            content: { id: '1', title: 'Checkout spec', ancestors: [] },
            excerpt: 'the @@@hl@@@cart@@@endhl@@@ flow',
            lastModified: '2026-09-20T10:00:00Z',
            resultGlobalContainer: { title: 'ORV' },
          },
          {
            content: { id: '2', title: 'Environments & Access', ancestors: [] },
          },
          { content: { id: '666', title: 'Excluded notes', ancestors: [] } },
          {
            content: {
              id: '3',
              title: 'Staging env',
              ancestors: [{ id: '2', title: 'Environments & Access' }],
            },
          },
          // No ancestors in the reply: cannot vouch for it
          { content: { id: '4', title: 'Orphan' } },
        ],
      }),
    );
    global.fetch = fetchMock as any;

    const text = await new ConfluenceSearch(env(CONFIG)).search(
      'cart" OR space = "HR',
    );

    const cql = decodeURIComponent(
      new URL((fetchMock.mock.calls[0] as any)[0]).searchParams.get('cql') ??
        '',
    );
    expect(cql).toContain('space in ("ORV") AND ancestor NOT IN (666)');
    expect(cql).toContain('text ~ "cart  OR space =  HR"');
    expect(text).toContain(
      '1 | Checkout spec | ORV | edited 2026-09-20 | the cart flow',
    );
    expect(text).not.toContain('Access');
    expect(text).not.toContain('Excluded');
    expect(text).not.toContain('Staging env');
    expect(text).not.toContain('Orphan');
  });

  it('reads a page in an allowed space with its child pages', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/spaces?keys=ORV'))
        return json({ results: [{ id: 77, key: 'ORV' }] });
      if (url.includes('/ancestors')) return json({ results: [{ id: '5' }] });
      if (url.endsWith('/pages/5')) return json({ id: '5', title: 'Product' });
      if (url.includes('/children'))
        return json({
          results: [
            { id: '11', title: 'Payments' },
            { id: '12', title: 'Staging passwords' },
          ],
        });
      return json({
        id: '10',
        title: 'Checkout spec',
        spaceId: '77',
        version: { number: 3, createdAt: '2026-09-20T10:00:00Z' },
        body: { storage: { value: '<p>Pay with card</p>' } },
      });
    }) as any;

    const text = await new ConfluenceSearch(env(CONFIG)).readPage('10');

    expect(text).toBe(
      '## Checkout spec (page 10, v3, edited 2026-09-20)\nPay with card\n\nChild pages: 11 Payments',
    );
  });

  it('refuses pages outside the spaces, excluded ids and access pages', async () => {
    const page = (id: string, title: string, spaceId: string) => ({
      id,
      title,
      spaceId,
      body: { storage: { value: '<p>x</p>' } },
    });
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/spaces?keys=')) return json({ results: [{ id: 77 }] });
      if (url.includes('/pages/20?'))
        return json(page('20', 'HR policy', '99'));
      if (url.includes('/pages/30?'))
        return json(page('30', 'Environments & Access', '77'));
      if (url.includes('/pages/500?'))
        return json(page('500', 'Release plan', '99'));
      if (url.includes('/pages/40?'))
        return json(page('40', 'Staging env', '77'));
      if (url.includes('/pages/40/ancestors'))
        return json({ results: [{ id: '41' }] });
      if (url.endsWith('/pages/41'))
        return json({ id: '41', title: 'Environments & Access' });
      if (url.includes('/pages/50?')) return json(page('50', 'Runbook', '77'));
      if (url.includes('/pages/50/ancestors'))
        return json({ results: [{ id: '666' }] });
      return json({ results: [] });
    }) as any;
    const search = new ConfluenceSearch(env(CONFIG));

    await expect(search.readPage('20')).rejects.toThrow('outside');
    await expect(search.readPage('30')).rejects.toThrow('access details');
    await expect(search.readPage('666')).rejects.toThrow('not readable');
    await expect(search.readPage('../x')).rejects.toThrow('digits');
    // Under an access page, or under an excluded page
    await expect(search.readPage('40')).rejects.toThrow('closed to the bot');
    await expect(search.readPage('50')).rejects.toThrow('closed to the bot');
    // A page the snapshot already reads is allowed whatever its space
    await expect(search.readPage('500')).resolves.toContain('Release plan');
  });
});
