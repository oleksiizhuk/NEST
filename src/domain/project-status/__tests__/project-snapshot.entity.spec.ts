import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';

const at = new Date('2026-09-23T05:00:00Z');
const snapshot = new ProjectSnapshot('s1', at, [
  {
    source: 'issues',
    ok: true,
    fetchedAt: at,
    text: 'ABC-1 | Done',
    error: null,
  },
  {
    source: 'code',
    ok: false,
    fetchedAt: new Date('2026-09-22T05:00:00Z'),
    text: 'old PRs',
    error: 'github responded 401',
  },
]);

describe('ProjectSnapshot', () => {
  it('renders the same bytes every time, marking failed sources', () => {
    const text = snapshot.render();
    expect(text).toBe(snapshot.render());
    expect(text).toContain(
      '<snapshot generated_at="2026-09-23T05:00:00.000Z">',
    );
    expect(text).toContain(
      '<issues status="fetched 2026-09-23T05:00:00.000Z">',
    );
    expect(text).toContain(
      'FAILED (github responded 401) — showing data from 2026-09-22T05:00:00.000Z',
    );
  });

  it('knows its age', () => {
    expect(snapshot.isOlderThan(new Date('2026-09-24T10:00:00Z'), 30)).toBe(
      false,
    );
    expect(snapshot.isOlderThan(new Date('2026-09-24T12:00:00Z'), 30)).toBe(
      true,
    );
  });
});
