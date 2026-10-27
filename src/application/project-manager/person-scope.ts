import {
  ProjectSnapshot,
  SnapshotSection,
} from '@domain/project-status/project-snapshot.entity';

// Personal mode: the model sees one person's work, not the whole project.
// The snapshot text is ours (one issue per line, see formatIssue), so it is
// narrowed line by line: that person's tickets, the tickets linked to them,
// lines naming them, and every line that is not about a particular ticket or
// PR (headers, totals). Roughly a tenth of the team-wide prompt.
export interface PersonScope {
  // Jira display name
  name: string;
  // From the Jira → GitHub mapping on the Сотрудники page
  githubLogin?: string | null;
}

// A ticket key, also inside a branch name (feature/abc-12-login)
const KEY = /(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]{1,9}-\d+(?!\d)/g;
// The same in capitals only: whether a line is about a particular ticket
const STRICT_KEY = /(?<![A-Za-z0-9])[A-Z][A-Z0-9]{1,9}-\d+(?!\d)/;
const ISSUE_LINE = /^([A-Z][A-Z0-9]{1,9}-\d+) \| /;
const PR_REF = /#\d+(?!\w)/;
// Where a PR reference starts, its repo name included (web#12)
const PR_START = /[\w.-]*#\d+(?!\w)/;
const HEADING = /^(#{1,4} |<)/;

const keysIn = (line: string): string[] =>
  (line.match(KEY) ?? []).map((k) => k.toUpperCase());

// key | status | type | priority | assignee | by reporter | …
const isTheirs = (line: string, name: string): boolean => {
  const f = line.split(' | ').map((x) => x.toLowerCase());
  const n = name.toLowerCase();
  return f[4] === n || f.includes(`by ${n}`);
};

// Where a line starts listing tickets or PRs ("Past due date: 3 — ABC-1…")
const firstRef = (line: string): number => {
  const at = [line.search(STRICT_KEY), line.search(PR_START)].filter(
    (i) => i >= 0,
  );
  return at.length ? Math.min(...at) : -1;
};

// A totals line keeps its numbers without other people's keys; a row that
// is all about one ticket or PR has nothing left and goes
const countOnly = (line: string): string | null => {
  const head = line
    .slice(0, firstRef(line))
    .replace(/[\s,:;—–(-]+$/, '')
    .trim();
  return /\d/.test(head) && /\p{L}{3}/u.test(head) ? `${head} …` : null;
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Scoped {
  name: string;
  mine: Set<string>;
  related: Set<string>;
  // A line that names the person, their GitHub login or a related ticket
  about: (line: string) => boolean;
}

const scoped = (snapshot: ProjectSnapshot, scope: PersonScope): Scoped => {
  const name = scope.name.trim();
  const issueLines = (snapshot.section('issues')?.text ?? '')
    .split('\n')
    .filter((l) => ISSUE_LINE.test(l));
  const mine = new Set<string>();
  for (const line of issueLines)
    if (isTheirs(line, name)) mine.add(line.match(ISSUE_LINE)![1]);
  // Linked both ways: what my tickets point at (blocked by, parent) and
  // what points at mine (blocks, relates)
  const related = new Set(mine);
  for (const line of issueLines) {
    const key = line.match(ISSUE_LINE)![1];
    const keys = keysIn(line);
    if (mine.has(key)) keys.forEach((k) => related.add(k));
    else if (keys.some((k) => mine.has(k))) related.add(key);
  }
  const names = [name, scope.githubLogin ?? '']
    .map((n) => n.trim())
    .filter(Boolean)
    .map(
      (n) =>
        new RegExp(`(?<![\\p{L}\\p{N}_])${escape(n)}(?![\\p{L}\\p{N}_])`, 'iu'),
    );
  const about = (line: string) =>
    names.some((r) => r.test(line)) || keysIn(line).some((k) => related.has(k));
  return { name, mine, related, about };
};

// Whether a line (an alert, a signal) is about the person's work
export const personMatcher = (
  snapshot: ProjectSnapshot,
  scope: PersonScope,
): ((line: string) => boolean) => scoped(snapshot, scope).about;

export const personalView = (
  snapshot: ProjectSnapshot,
  scope: PersonScope,
): ((section: SnapshotSection) => string) => {
  const { name, mine, related, about: aboutThem } = scoped(snapshot, scope);
  return (section) => {
    const lines = section.text.split('\n');
    const kept =
      section.source === 'docs' || section.source === 'design'
        ? // Pages and frames are prose: headings and what names them only;
          // the rest stays a tool call away
          lines.filter((l) => HEADING.test(l) || aboutThem(l))
        : lines.flatMap((l) => {
            const issue = l.match(ISSUE_LINE);
            if (issue) return related.has(issue[1]) || aboutThem(l) ? [l] : [];
            if (firstRef(l) < 0 || aboutThem(l)) return [l];
            // Someone else's work: totals keep their numbers, rows go
            const count = countOnly(l);
            return count ? [count] : [];
          });
    const dropped = lines.length - kept.length;
    const note =
      section.source === 'issues'
        ? mine.size
          ? `(Personal view for ${name}: ${mine.size} of their tickets, ${
              related.size - mine.size
            } linked; ${dropped} other lines left out, totals shortened — search_project / jira_get_issue read them.)`
          : `(Personal view for ${name}: no ticket in this snapshot has them as assignee or reporter. Say so and ask the owner to check the name on the admin Settings page — it must match Jira exactly.)`
        : dropped
        ? `(Personal view for ${name}: ${dropped} lines about other people's work left out.)`
        : '';
    return [note, ...kept].filter(Boolean).join('\n');
  };
};
