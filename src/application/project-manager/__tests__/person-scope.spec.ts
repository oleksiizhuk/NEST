import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import {
  personalView,
  personMatcher,
} from '@application/project-manager/person-scope';

const at = new Date('2026-10-27T05:00:00Z');
const issues = [
  '## Computed metrics',
  'Open 40, in progress 12, bugs 5',
  'Stale > 5 days: ABC-9 (Lena Ward), ABC-3 (Max Brenner)',
  '## Open issues: 5',
  'key | status | type | priority | assignee | by reporter | … | summary',
  'ABC-1 | In Progress | Story | High | Max Brenner | by Anna | is blocked by ABC-2(Open) | Login screen',
  'ABC-2 | Open | Task | High | Lena Ward | by Anna | blocks ABC-1(In Progress) | Auth endpoint',
  'ABC-3 | On DEV | Bug | Medium | Lena Ward | by Max Brenner | Crash on start',
  'ABC-4 | Open | Task | Low | Tomas | by Anna | relates to ABC-1(In Progress) | Copy',
  'ABC-9 | Open | Task | Low | Lena Ward | by Anna | Dashboard filters',
].join('\n');
const code = [
  '## Open PRs',
  'app#12 by maxb | ABC-1 login | 2d',
  'web#40 by lenaw | ABC-9 filters | 1d',
  'web#41 by lenaw | chore deps | 3d',
  'Pipelines: all green',
].join('\n');
const docs = [
  '# Release page',
  'The dashboard ships later.',
  'Login (ABC-1) needs the new auth endpoint.',
].join('\n');
const snapshot = new ProjectSnapshot('s', at, [
  { source: 'issues', ok: true, fetchedAt: at, text: issues, error: null },
  { source: 'code', ok: true, fetchedAt: at, text: code, error: null },
  { source: 'docs', ok: true, fetchedAt: at, text: docs, error: null },
]);
const scope = { name: 'Max Brenner', githubLogin: 'maxb' };

describe('personal view of the snapshot', () => {
  const view = personalView(snapshot, scope);
  const text = (source: 'issues' | 'code' | 'docs') =>
    view(snapshot.section(source)!);

  it("keeps the person's tickets, reported ones and links both ways", () => {
    const out = text('issues');
    // assigned, reported, blocks theirs, relates to theirs
    for (const key of ['ABC-1 |', 'ABC-2 |', 'ABC-3 |', 'ABC-4 |'])
      expect(out).toContain(key);
    expect(out).not.toContain('ABC-9 |');
    expect(out).toContain('Open 40, in progress 12');
    expect(out).toContain('2 of their tickets, 2 linked');
  });

  it("drops lines only about other people's tickets and PRs", () => {
    expect(text('issues')).toContain('Stale > 5 days: ABC-9');
    const out = text('code');
    expect(out).toContain('app#12 by maxb');
    expect(out).toContain('Pipelines: all green');
    expect(out).not.toContain('web#41');
    expect(out).not.toContain('web#40');
  });

  it('keeps only headings and lines about them from docs', () => {
    const out = text('docs');
    expect(out).toContain('# Release page');
    expect(out).toContain('Login (ABC-1)');
    expect(out).not.toContain('dashboard ships later');
  });

  it('renders through the snapshot, byte-stable', () => {
    expect(snapshot.render(view)).toBe(
      snapshot.render(personalView(snapshot, scope)),
    );
  });

  it('shrinks a team-sized snapshot to a fraction', () => {
    const others = Array.from(
      { length: 200 },
      (_, i) =>
        `ABC-${
          100 + i
        } | Open | Task | Low | Lena Ward | by Anna | Other work ${i}`,
    );
    const big = new ProjectSnapshot('b', at, [
      {
        source: 'issues',
        ok: true,
        fetchedAt: at,
        text: [issues, ...others].join('\n'),
        error: null,
      },
    ]);
    const full = big.render().length;
    expect(big.render(personalView(big, scope)).length).toBeLessThan(full / 5);
  });

  it('tells alerts about the person from the rest', () => {
    const about = personMatcher(snapshot, scope);
    expect(about('ABC-2 blocked for 6 days')).toBe(true);
    expect(about('maxb: PR waiting for review')).toBe(true);
    expect(about('ABC-9 stale')).toBe(false);
    expect(about('Release in 2 working days')).toBe(false);
  });
});
