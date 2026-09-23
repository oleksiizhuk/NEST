import { FigmaActivityReader } from '@infrastructure/project-manager/figma-activity.reader';

const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);
const json = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    headers: new Headers(),
  });

describe('FigmaActivityReader', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('is off without a token or a valid file key', () => {
    expect(
      new FigmaActivityReader(
        env({ PM_FIGMA_FILE_KEYS: 'AbCdEfGhIjKlMnOp' }),
      ).isConfigured(),
    ).toBe(false);
    expect(
      new FigmaActivityReader(
        env({ PM_FIGMA_TOKEN: 't', PM_FIGMA_FILE_KEYS: 'bad key!' }),
      ).isConfigured(),
    ).toBe(false);
  });

  it('summarises pages, recent named versions, edit activity and open comments', async () => {
    const now = new Date('2026-09-23T10:00:00Z');
    const seen: Array<{ url: string; token: string | null }> = [];
    global.fetch = jest.fn((url: string, init: RequestInit) => {
      seen.push({
        url,
        token: (init.headers as Record<string, string>)['X-Figma-Token'],
      });
      if (url.includes('/versions')) {
        return json({
          versions: [
            {
              id: 'v3',
              created_at: '2026-09-22T12:00:00Z',
              label: 'Search empty state',
              description: 'warm bg',
              user: { handle: 'Eugene' },
            },
            {
              id: 'v2',
              created_at: '2026-09-21T12:00:00Z',
              label: null,
              description: null,
              user: { handle: 'Eugene' },
            },
            {
              id: 'v1',
              created_at: '2026-08-01T12:00:00Z',
              label: 'Old',
              description: null,
              user: { handle: 'Eugene' },
            },
          ],
        });
      }
      if (url.includes('/comments')) {
        return json({
          comments: [
            {
              id: 'c1',
              message: 'Is the RTL version ready?',
              created_at: '2026-09-20T09:00:00Z',
              resolved_at: null,
              user: { handle: 'Anna' },
              client_meta: { node_id: '12:34' },
            },
            {
              id: 'c2',
              message: 'reply',
              parent_id: 'c1',
              created_at: '2026-09-20T10:00:00Z',
              resolved_at: null,
              user: { handle: 'Eugene' },
            },
            {
              id: 'c3',
              message: 'old resolved',
              created_at: '2026-07-01T09:00:00Z',
              resolved_at: '2026-07-02T09:00:00Z',
              user: { handle: 'Anna' },
            },
          ],
        });
      }
      return json({
        name: 'Mobile App — UI Design',
        lastModified: '2026-09-22T12:30:00Z',
        document: {
          id: '0:0',
          name: 'Document',
          type: 'DOCUMENT',
          children: [
            {
              id: '1:1',
              name: 'Search',
              type: 'CANVAS',
              children: [
                { id: '10:1', name: 'Search / Results', type: 'FRAME' },
                { id: '10:2', name: 'note', type: 'TEXT' },
              ],
            },
          ],
        },
      });
    }) as any;

    const text = await new FigmaActivityReader(
      env({ PM_FIGMA_TOKEN: 'secret', PM_FIGMA_FILE_KEYS: 'AbCdEfGhIjKlMnOp' }),
    ).fetch(now);

    expect(seen.every((s) => s.token === 'secret')).toBe(true);
    expect(seen[0].url).toBe(
      'https://api.figma.com/v1/files/AbCdEfGhIjKlMnOp?depth=2',
    );
    expect(text).toContain(
      '## Figma: Mobile App — UI Design (file AbCdEfGhIjKlMnOp, last modified 2026-09-22 12:30)',
    );
    expect(text).toContain(
      '- Search [1:1] (1 top-level): Search / Results [10:1]',
    );
    expect(text).toContain('09-22 Eugene: Search empty state — warm bg');
    expect(text).not.toContain('Old');
    expect(text).toContain('Edit activity by day: 09-22 Eugene; 09-21 Eugene');
    expect(text).toContain('Comments: 1 unresolved');
    expect(text).toContain('09-20 Anna on 12:34: Is the RTL version ready?');
    expect(text).not.toContain('old resolved');
  });
});
