import { median } from '@application/project-manager/load';

// Who reviews, who waits, how big the PRs are: counted at refresh from the
// open PRs and the PRs merged in the last 30 days, per repo, no model call.

export const REVIEW_WINDOW_DAYS = 30;
// A PR larger than this is hard to review well
export const BIG_PR_LINES = 400;

export interface PrFact {
  repo: string;
  number: number;
  author: string;
  draft: boolean;
  // Ready for review (or created when never a draft)
  readyAt: string;
  mergedAt: string | null;
  lines: number;
  files: number;
  reviews: Array<{ login: string; at: string; state: string }>;
  requested: string[];
}

export interface ReviewLoad {
  windowDays: number;
  merged: number;
  // Hours from ready to the first review by someone else, merged + open
  firstReview: { p50: number | null; p85: number | null };
  reviewers: Array<{
    login: string;
    // Open PRs that asked this person and have no review from them yet
    pending: number;
    // Distinct PRs reviewed in the window
    reviewed: number;
    share: number;
  }>;
  authors: Array<{
    login: string;
    merged: number;
    waitHours: number | null;
  }>;
  // One person does more than half of all reviews
  concentration: { login: string; share: number } | null;
  size: { medianLines: number | null; big: number; bigShare: number };
  noReview: Array<{ repo: string; number: number; author: string }>;
  manyRounds: Array<{ repo: string; number: number; rounds: number }>;
  // Open PRs waiting longest for a first review
  waiting: Array<{
    repo: string;
    number: number;
    author: string;
    hours: number;
    requested: string[];
  }>;
}

const isBot = (login: string) => /\[bot\]$|-bot$|^dependabot/i.test(login);

const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
};

const hours = (from: string, to: number) =>
  Math.max(0, Math.round((to - Date.parse(from)) / 3_600_000));

export const reviewLoad = (prs: PrFact[], now: Date): ReviewLoad => {
  const since = now.getTime() - REVIEW_WINDOW_DAYS * 86_400_000;
  const humans = (pr: PrFact) =>
    pr.reviews
      .filter((r) => r.login && r.login !== pr.author && !isBot(r.login))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const merged = prs.filter(
    (p) => p.mergedAt && Date.parse(p.mergedAt) >= since && !isBot(p.author),
  );
  const open = prs.filter((p) => !p.mergedAt && !p.draft && !isBot(p.author));

  const firstWaits: number[] = [];
  const waitsBy = new Map<string, number[]>();
  const reviewedBy = new Map<string, Set<string>>();
  let reviewsTotal = 0;
  for (const pr of [...merged, ...open]) {
    const list = humans(pr);
    const first = list[0];
    if (first) {
      const h = hours(pr.readyAt, Date.parse(first.at));
      firstWaits.push(h);
      const w = waitsBy.get(pr.author) ?? [];
      w.push(h);
      waitsBy.set(pr.author, w);
    }
    for (const r of list) {
      if (Date.parse(r.at) < since) continue;
      const set = reviewedBy.get(r.login) ?? new Set<string>();
      const id = `${pr.repo}#${pr.number}`;
      if (!set.has(id)) reviewsTotal += 1;
      set.add(id);
      reviewedBy.set(r.login, set);
    }
  }

  const pending = new Map<string, number>();
  for (const pr of open) {
    const done = new Set(humans(pr).map((r) => r.login));
    for (const who of pr.requested)
      if (!done.has(who) && !isBot(who))
        pending.set(who, (pending.get(who) ?? 0) + 1);
  }
  const logins = new Set([...reviewedBy.keys(), ...pending.keys()]);
  const reviewers = [...logins]
    .map((login) => {
      const reviewed = reviewedBy.get(login)?.size ?? 0;
      return {
        login,
        pending: pending.get(login) ?? 0,
        reviewed,
        share: reviewsTotal
          ? Math.round((reviewed / reviewsTotal) * 100) / 100
          : 0,
      };
    })
    .sort((a, b) => b.reviewed - a.reviewed || b.pending - a.pending);
  const top = reviewers[0];

  const authorsMerged = new Map<string, number>();
  for (const pr of merged)
    authorsMerged.set(pr.author, (authorsMerged.get(pr.author) ?? 0) + 1);
  const authors = [...new Set([...authorsMerged.keys(), ...waitsBy.keys()])]
    .map((login) => {
      const w = waitsBy.get(login);
      return {
        login,
        merged: authorsMerged.get(login) ?? 0,
        waitHours: w?.length ? median(w) : null,
      };
    })
    .sort((a, b) => b.merged - a.merged);

  const sizes = merged.map((p) => p.lines);
  const big = merged.filter((p) => p.lines > BIG_PR_LINES).length;

  return {
    windowDays: REVIEW_WINDOW_DAYS,
    merged: merged.length,
    firstReview: {
      p50: percentile(firstWaits, 50),
      p85: percentile(firstWaits, 85),
    },
    reviewers,
    authors,
    concentration:
      top && reviewsTotal >= 5 && top.share > 0.5
        ? { login: top.login, share: top.share }
        : null,
    size: {
      medianLines: sizes.length ? median(sizes) : null,
      big,
      bigShare: merged.length
        ? Math.round((big / merged.length) * 100) / 100
        : 0,
    },
    noReview: merged
      .filter((p) => !humans(p).length)
      .map((p) => ({ repo: p.repo, number: p.number, author: p.author }))
      .slice(0, 15),
    manyRounds: [...merged, ...open]
      .map((p) => ({
        repo: p.repo,
        number: p.number,
        rounds: humans(p).filter((r) => r.state === 'CHANGES_REQUESTED').length,
      }))
      .filter((p) => p.rounds >= 2)
      .sort((a, b) => b.rounds - a.rounds)
      .slice(0, 10),
    waiting: open
      .filter((p) => !humans(p).length)
      .map((p) => ({
        repo: p.repo,
        number: p.number,
        author: p.author,
        hours: hours(p.readyAt, now.getTime()),
        requested: p.requested,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10),
  };
};
