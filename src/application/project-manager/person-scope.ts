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

const KEY = /(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d+(?![\w-])/g;
const ISSUE_LINE = /^([A-Z][A-Z0-9]{1,9}-\d+) \| /;
const PR_REF = /#\d+(?!\w)/;
const HEADING = /^(#{1,4} |<)/;

const keysIn = (line: string): string[] => line.match(KEY) ?? [];

// key | status | type | priority | assignee | by reporter | …
const isTheirs = (line: string, name: string): boolean => {
  const f = line.split(' | ');
  return f[4] === name || f.includes(`by ${name}`);
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
        : lines.filter((l) => {
            const issue = l.match(ISSUE_LINE);
            if (issue) return related.has(issue[1]);
            // A line about other tickets or PRs is someone else's work
            if (keysIn(l).length || PR_REF.test(l)) return aboutThem(l);
            return true;
          });
    const dropped = lines.length - kept.length;
    const note =
      section.source === 'issues'
        ? `(Personal view for ${name}: ${mine.size} of their tickets, ${
            related.size - mine.size
          } linked; ${dropped} other lines left out — search_project / jira_get_issue read them.)`
        : dropped
        ? `(Personal view for ${name}: ${dropped} lines about other people's work left out.)`
        : '';
    return [note, ...kept].filter(Boolean).join('\n');
  };
};
