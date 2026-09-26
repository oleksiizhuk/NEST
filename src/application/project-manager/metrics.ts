import {
  workingDaysBetween,
  workingDaysLeft,
} from '@application/project-manager/release-clock';

// Numbers a manager needs, computed in code so the model does not count a
// few hundred lines by eye. The model gets them as a ready block and is told
// to trust them over its own counting.

export interface IssueFact {
  key: string;
  summary?: string;
  // Keys of open issues this one is blocked by
  blockedBy?: string[];
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
  // Jira components, for the areas page
  components?: string[];
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
// Only an explicit Blocker priority; Highest/Critical is urgent, not blocked
const BLOCKER_PRIORITIES = new Set(['blocker']);
// Branches whose red pipeline is worth an alert
const RELEASE_BRANCHES = new Set([
  'main',
  'master',
  'production',
  'preproduction',
  'staging',
  'dev',
]);
const RED_ALERT_MS = 2 * 3_600_000;

const keys = (items: IssueFact[]): string =>
  items
    .slice(0, MAX_KEYS)
    .map((i) => i.key)
    .join(', ') +
  (items.length > MAX_KEYS ? ` +${items.length - MAX_KEYS}` : '');

const isHigh = (i: IssueFact): boolean =>
  HIGH_PRIORITIES.has((i.priority ?? '').toLowerCase());

// One test for bugs everywhere (snapshot metrics, Качество, cards)
export const isBug = (i: IssueFact): boolean =>
  /bug|defect|incident|баг|ошибк/i.test(i.type);

export const isBlocker = (i: IssueFact): boolean =>
  BLOCKER_PRIORITIES.has((i.priority ?? '').toLowerCase()) ||
  /block/i.test(i.status) ||
  Boolean(i.blockedBy?.length);

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
  // Filled with the headline numbers, for trends across snapshots
  out: Record<string, number> = {},
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
  out.open = open.length;
  out.inProgress = inProgress.length;
  out.done14 = recentDone.length;
  lines.push(
    `Open work items: ${open.length}${lower} — to do ${
      open.length - inProgress.length
    }, in progress ${inProgress.length}.`,
  );

  // Release scope and forecast
  const scope = options.releaseVersion
    ? open.filter((i) => i.fixVersions.includes(options.releaseVersion ?? ''))
    : open;
  out.scope = scope.length;
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
  out.unassigned = unassigned.length;
  out.unassignedHigh = unassignedHigh.length;
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
  out.stale = stale.length;
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
  out.overdue = overdue.length;
  if (overdue.length) {
    lines.push(`Past due date: ${overdue.length} — ${keys(overdue)}.`);
  }

  // Bugs
  const openBugs = open.filter(isBug);
  out.openBugs = openBugs.length;
  out.openHighBugs = openBugs.filter(isHigh).length;
  out.blockers = scope.filter(isBlocker).length;
  // Release gates count only the release scope
  out.scopeHighBugs = scope.filter((i) => isBug(i) && isHigh(i)).length;
  out.scopeUnassignedHigh = scope.filter(
    (i) => !i.assignee && isHigh(i),
  ).length;
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
    out.bugsReported14 = newBugs;
    out.bugsFixed14 = fixedBugs;
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

// Runs arrive newest first; a workflow is red while its latest run failed.
// "Red since" is the oldest failure in the unbroken streak we can see.
const redStreaks = (
  runs: RunFact[],
): Array<[string, { red: boolean; since: string; done: boolean }]> => {
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
  return [...streaks].filter(([, st]) => st.red);
};

export const codeMetrics = (
  pulls: PullFact[],
  runs: RunFact[],
  now: Date,
  // Repos that could not be read; their PRs and runs are not in the numbers
  missing: string[] = [],
  out: Record<string, number> = {},
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
  out.openPrs = pulls.length;
  out.waitingReview = waiting.length;
  out.changesStalled = changes.length;
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

  const streaks = redStreaks(runs);
  const red = streaks.map(
    ([key, s]) =>
      `${key} since ${s.since.slice(0, 10)} (${workingDaysBetween(
        new Date(s.since),
        now,
      )} working days)`,
  );
  out.redPipelines = red.length;
  lines.push(`Red pipelines: ${red.length ? red.join('; ') : 'none'}.`);
  return lines.join('\n');
};

const LABELS: Record<string, string> = {
  open: 'open items',
  inProgress: 'in progress',
  scope: 'release scope open',
  done14: 'finished in 14 days',
  unassigned: 'unassigned',
  unassignedHigh: 'unassigned high priority',
  stale: 'stuck in progress',
  overdue: 'past due',
  openBugs: 'open bugs',
  bugsReported14: 'bugs reported in 14 days',
  bugsFixed14: 'bugs fixed in 14 days',
  openPrs: 'open PRs',
  waitingReview: 'PRs waiting for review',
  changesStalled: 'stalled change requests',
  redPipelines: 'red pipelines',
};

// "open items 40 → 44 (+4)" for every number that moved since `base`
export const trendLine = (
  now: Record<string, number>,
  base: Record<string, number> | undefined,
): string => {
  if (!base) return 'no earlier numbers';
  const moved = Object.keys(LABELS)
    .filter((k) => k in now && k in base && now[k] !== base[k])
    .map((k) => {
      const d = now[k] - base[k];
      return `${LABELS[k]} ${base[k]} → ${now[k]} (${d > 0 ? '+' : ''}${d})`;
    });
  return moved.length ? moved.join('; ') : 'no change';
};

const short = (i: IssueFact): string =>
  `${i.key}${i.summary ? ` «${i.summary.slice(0, 80)}»` : ''} — ${
    i.assignee ?? 'без исполнителя'
  }`;

// Item-level events for alerts; the same scope rules as the metrics
export const issueSignals = (
  openAll: IssueFact[],
  releaseVersion: string | null,
): Array<{ rule: string; subject: string; text: string }> => {
  const open = openAll.filter(isWork);
  const scope = releaseVersion
    ? open.filter((i) => i.fixVersions.includes(releaseVersion))
    : open;
  return [
    ...open.filter(isBlocker).map((i) => ({
      rule: 'blocker',
      subject: i.key,
      text: `${short(i)}${
        i.blockedBy?.length ? `, заблокирована ${i.blockedBy.join(', ')}` : ''
      } (${i.priority ?? '-'}, ${i.status})`,
    })),
    ...scope
      .filter((i) => !i.assignee && isHigh(i))
      .map((i) => ({
        rule: 'release-unassigned',
        subject: i.key,
        text: `${short(i)} (${i.priority})`,
      })),
  ];
};

// Red release branches (red for over 2 hours) and PRs waiting for review
export const codeSignals = (
  pulls: PullFact[],
  runs: RunFact[],
  now: Date,
): Array<{ rule: string; subject: string; text: string }> => {
  const signals: Array<{ rule: string; subject: string; text: string }> = [];
  for (const p of pulls) {
    if (
      !p.draft &&
      p.reviews === 0 &&
      workingDaysBetween(waitStart(p), now) > REVIEW_WAIT_DAYS
    ) {
      signals.push({
        rule: 'review-wait',
        subject: `${p.repo}#${p.number}`,
        text: `${p.repo}#${p.number} от ${
          p.author
        } ждёт ревью ${workingDaysBetween(waitStart(p), now)} раб. дн.`,
      });
    }
  }
  for (const [key, s] of redStreaks(runs)) {
    const branch = key.split('@').pop() ?? '';
    if (
      RELEASE_BRANCHES.has(branch) &&
      now.getTime() - new Date(s.since).getTime() > RED_ALERT_MS
    ) {
      signals.push({
        rule: 'red-pipeline',
        // One alert per red episode: the watch re-arms the key once the
        // pipeline is green again ("since" moves as old runs leave the
        // fetched window, so it cannot be part of the key)
        subject: key,
        text: `${key} красный с ${s.since.slice(0, 16).replace('T', ' ')} UTC`,
      });
    }
  }
  return signals;
};
