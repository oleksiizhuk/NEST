import {
  workingDaysBetween,
  workingDaysLeft,
} from '@application/project-manager/release-clock';

// Numbers a manager needs, computed in code so the model does not count a
// few hundred lines by eye. The model gets them as a ready block and is told
// to trust them over its own counting.

export interface IssueFact {
  key: string;
  type: string;
  status: string;
  // Jira status category: new (to do), indeterminate (in progress), done
  category: 'new' | 'indeterminate' | 'done';
  priority: string | null;
  assignee: string | null;
  fixVersions: string[];
  created: string | null;
  // When it reached Done (resolution date, else the category change)
  doneAt: string | null;
  // When it entered its current status category
  statusSince: string | null;
  due: string | null;
}

export interface IssueMetricsOptions {
  releaseDate: string | null;
  // Jira fixVersion that is the release scope; null = all open issues
  releaseVersion: string | null;
  // True when that list hit its cap: its counts are lower bounds
  openCapped: boolean;
  doneCapped: boolean;
}

const THROUGHPUT_WINDOW_DAYS = 14;
const STALE_WORKING_DAYS = 5;
const WIP_LIMIT = 2;
const MAX_KEYS = 8;
const HIGH_PRIORITIES = new Set(['highest', 'high', 'critical', 'blocker']);

const keys = (items: IssueFact[]): string =>
  items
    .slice(0, MAX_KEYS)
    .map((i) => i.key)
    .join(', ') +
  (items.length > MAX_KEYS ? ` +${items.length - MAX_KEYS}` : '');

const isHigh = (i: IssueFact): boolean =>
  HIGH_PRIORITIES.has((i.priority ?? '').toLowerCase());

const isBug = (i: IssueFact): boolean => /bug|defect/i.test(i.type);

// Epics are containers; counting them next to their stories double-counts
const isWork = (i: IssueFact): boolean => !/^epic$/i.test(i.type);

const daysAgo = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 86_400_000);

export const verdictHint = (
  daysNeeded: number | null,
  daysLeft: number,
): string => {
  if (daysNeeded === null) return 'NO DATA (nothing finished in 14 days)';
  if (daysLeft <= 0) return 'RELEASE DAY OR PAST';
  const buffer = (daysLeft - daysNeeded) / daysLeft;
  if (buffer >= 0.2) return 'ON TRACK';
  if (buffer >= 0) return 'AT RISK';
  return 'OFF TRACK';
};

export const issueMetrics = (
  openAll: IssueFact[],
  doneAll: IssueFact[],
  now: Date,
  options: IssueMetricsOptions,
): string => {
  const open = openAll.filter(isWork);
  const done = doneAll.filter(isWork);
  const since = daysAgo(now, THROUGHPUT_WINDOW_DAYS);
  const recentDone = done.filter(
    (i) => i.doneAt && new Date(i.doneAt) >= since,
  );
  const lines: string[] = [];
  const lower = options.openCapped ? ' (lower bound: list capped)' : '';
  const paceLower = options.doneCapped
    ? ' (lower bound: done list capped, so the pace is understated)'
    : '';
  const asOf = now.toISOString().slice(0, 10);

  const inProgress = open.filter((i) => i.category === 'indeterminate');
  lines.push(
    `Open work items: ${open.length}${lower} — to do ${
      open.length - inProgress.length
    }, in progress ${inProgress.length}.`,
  );

  // Release scope and forecast
  const scope = options.releaseVersion
    ? open.filter((i) => i.fixVersions.includes(options.releaseVersion ?? ''))
    : open;
  const scopeName = options.releaseVersion
    ? `fixVersion ${options.releaseVersion}`
    : 'all open items (no release version set)';
  const perDay = recentDone.length / 10; // 14 calendar days = 10 working days
  lines.push(
    `Finished in the last 14 days: ${recentDone.length} (${perDay.toFixed(
      1,
    )} per working day)${paceLower}.`,
  );
  if (options.releaseDate) {
    const left = workingDaysLeft(now, options.releaseDate);
    const needed =
      scope.length === 0
        ? 0
        : perDay > 0
        ? Math.ceil(scope.length / perDay)
        : null;
    lines.push(
      `Release scope (${scopeName}): ${scope.length} open${lower}. ` +
        `At the current pace that needs ${
          needed === null ? '?' : needed
        } working days; ${left} left as of ${asOf}. Hint: ${verdictHint(
          needed,
          left,
        )}${
          options.openCapped || options.doneCapped ? ' (from capped lists)' : ''
        }.`,
    );
  } else {
    lines.push(`Release scope (${scopeName}): ${scope.length} open${lower}.`);
  }
  if (!options.releaseVersion) {
    const versions = new Map<string, number>();
    open.forEach((i) =>
      i.fixVersions.forEach((v) => versions.set(v, (versions.get(v) ?? 0) + 1)),
    );
    const noVersion = open.filter((i) => !i.fixVersions.length).length;
    if (versions.size) {
      lines.push(
        `Open by fixVersion: ${[...versions]
          .sort((a, b) => b[1] - a[1])
          .map(([v, n]) => `${v} ${n}`)
          .join(', ')}; none ${noVersion}.`,
      );
    }
  }

  // Attention lists
  const unassignedHigh = open.filter((i) => !i.assignee && isHigh(i));
  const unassigned = open.filter((i) => !i.assignee);
  lines.push(
    `Unassigned: ${unassigned.length}` +
      (unassignedHigh.length
        ? `, of them high priority ${unassignedHigh.length}: ${keys(
            unassignedHigh,
          )}.`
        : '.'),
  );
  const stale = inProgress
    .filter(
      (i) =>
        i.statusSince &&
        workingDaysBetween(new Date(i.statusSince), now) > STALE_WORKING_DAYS,
    )
    .sort((a, b) => (a.statusSince ?? '').localeCompare(b.statusSince ?? ''));
  if (stale.length) {
    lines.push(
      `In progress for more than ${STALE_WORKING_DAYS} working days: ${
        stale.length
      } — ${stale
        .slice(0, MAX_KEYS)
        .map(
          (i) =>
            `${i.key} ${workingDaysBetween(
              new Date(i.statusSince ?? ''),
              now,
            )}d ${i.assignee ?? 'unassigned'}`,
        )
        .join(', ')}.`,
    );
  }
  const today = now.toISOString().slice(0, 10);
  const overdue = open.filter((i) => i.due && i.due < today);
  if (overdue.length) {
    lines.push(`Past due date: ${overdue.length} — ${keys(overdue)}.`);
  }

  // Bugs
  const openBugs = open.filter(isBug);
  if (openBugs.length || done.some(isBug)) {
    const byPriority = new Map<string, number>();
    openBugs.forEach((b) => {
      const p = b.priority ?? 'none';
      byPriority.set(p, (byPriority.get(p) ?? 0) + 1);
    });
    const newBugs = [...openAll, ...doneAll].filter(
      (i) => isBug(i) && i.created && new Date(i.created) >= since,
    ).length;
    const fixedBugs = recentDone.filter(isBug).length;
    lines.push(
      `Open bugs: ${openBugs.length} (${
        [...byPriority].map(([p, n]) => `${p} ${n}`).join(', ') || 'none'
      }); last 14 days: ${newBugs} reported, ${fixedBugs} fixed.`,
    );
  }

  // Load per person
  const people = new Map<string, { open: number; wip: number }>();
  open.forEach((i) => {
    const who = i.assignee ?? 'UNASSIGNED';
    const row = people.get(who) ?? { open: 0, wip: 0 };
    row.open += 1;
    if (i.category === 'indeterminate') row.wip += 1;
    people.set(who, row);
  });
  const load = [...people]
    .filter(([who]) => who !== 'UNASSIGNED')
    .sort((a, b) => b[1].open - a[1].open)
    .map(
      ([who, r]) =>
        `${who} ${r.open} open/${r.wip} in progress${
          r.wip > WIP_LIMIT ? ' (WIP high)' : ''
        }`,
    );
  if (load.length) lines.push(`Load: ${load.join('; ')}.`);

  return lines.join('\n');
};

export interface PullFact {
  repo: string;
  number: number;
  author: string;
  draft: boolean;
  createdAt: string;
  // When it left draft; the review wait starts here (else createdAt)
  readyAt?: string | null;
  updatedAt: string;
  // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null; undefined = unknown
  reviewDecision?: string | null;
  // Reviews by people other than the author (bots excluded); undefined = unknown
  reviews?: number;
}

export interface RunFact {
  repo: string;
  workflow: string;
  branch: string;
  conclusion: string | null;
  createdAt: string;
}

const REVIEW_WAIT_DAYS = 2;
// A run with one of these did not pass
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
// Neither pass nor fail (still running, cancelled, skipped, waiting for an
// approval): look past them to the previous run
const NEUTRAL = new Set([
  'cancelled',
  'skipped',
  'neutral',
  'stale',
  'action_required',
]);

const waitStart = (p: PullFact): Date => new Date(p.readyAt || p.createdAt);

export const codeMetrics = (
  pulls: PullFact[],
  runs: RunFact[],
  now: Date,
  // Repos that could not be read; their PRs and runs are not in the numbers
  missing: string[] = [],
): string => {
  const lines: string[] = [];
  if (missing.length) {
    lines.push(
      `NOT READ this time: ${missing.join(
        ', ',
      )}. Their PRs and pipelines are missing from every number below.`,
    );
  }
  const ready = pulls.filter((p) => !p.draft);
  const known = ready.filter((p) => p.reviews !== undefined);
  const waiting = known
    .filter(
      (p) =>
        p.reviews === 0 &&
        workingDaysBetween(waitStart(p), now) > REVIEW_WAIT_DAYS,
    )
    .map(
      (p) =>
        `${p.repo}#${p.number} ${p.author} ${workingDaysBetween(
          waitStart(p),
          now,
        )}d`,
    );
  const changes = ready
    .filter(
      (p) =>
        p.reviewDecision === 'CHANGES_REQUESTED' &&
        workingDaysBetween(new Date(p.updatedAt), now) > REVIEW_WAIT_DAYS,
    )
    .map((p) => `${p.repo}#${p.number} ${p.author}`);
  lines.push(
    `Open PRs: ${pulls.length} (${pulls.length - ready.length} drafts).`,
  );
  if (known.length < ready.length) {
    lines.push('Review state: unavailable for some repos.');
  }
  lines.push(
    `Waiting for a first review more than ${REVIEW_WAIT_DAYS} working days: ${
      waiting.length ? waiting.join(', ') : 'none'
    }.`,
  );
  if (changes.length) {
    lines.push(
      `Changes requested, no update for ${REVIEW_WAIT_DAYS}+ working days: ${changes.join(
        ', ',
      )}.`,
    );
  }

  // Runs arrive newest first; a workflow is red while its latest run failed.
  // "Red since" is the oldest failure in the unbroken streak we can see.
  const streaks = new Map<
    string,
    { red: boolean; since: string; done: boolean }
  >();
  for (const run of runs) {
    const key = `${run.repo}:${run.workflow}@${run.branch}`;
    if (run.conclusion === null || NEUTRAL.has(run.conclusion)) continue;
    const failed = FAILED.has(run.conclusion);
    const streak = streaks.get(key);
    if (!streak) {
      streaks.set(key, { red: failed, since: run.createdAt, done: !failed });
    } else if (!streak.done) {
      if (failed) streak.since = run.createdAt;
      else streak.done = true;
    }
  }
  const red = [...streaks]
    .filter(([, s]) => s.red)
    .map(
      ([key, s]) =>
        `${key} since ${s.since.slice(0, 10)} (${workingDaysBetween(
          new Date(s.since),
          now,
        )} working days)`,
    );
  lines.push(`Red pipelines: ${red.length ? red.join('; ') : 'none'}.`);
  return lines.join('\n');
};
