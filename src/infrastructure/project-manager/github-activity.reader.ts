import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IProjectSource,
  SourceResult,
} from '@application/project-manager/project-source.interface';
import { TeamCode } from '@application/project-manager/team';
import { workingDaysBetween } from '@application/project-manager/release-clock';
import {
  codeMetrics,
  codeSignals,
  PullFact,
  RunFact,
} from '@application/project-manager/metrics';
import {
  getJson,
  oneLine,
  shortDate,
} from '@infrastructure/project-manager/http-json';

const API = 'https://api.github.com';
// Branch-promotion PRs (dev→staging…) are releases, not work items
const PROMOTION_HEADS = new Set([
  'dev',
  'staging',
  'pre-dev',
  'main',
  'preproduction',
]);

interface Pull {
  number: number;
  title: string;
  draft?: boolean;
  user?: { login?: string };
  created_at: string;
  updated_at: string;
  merged_at?: string | null;
  head: { ref: string };
  base: { ref: string };
}

interface Run {
  name?: string;
  head_branch?: string;
  event?: string;
  status?: string;
  conclusion?: string | null;
  created_at: string;
}

interface Compare {
  spec: string; // repo:base...head
}

interface RepoActivity {
  text: string;
  pulls: PullFact[];
  runs: RunFact[];
  failed?: boolean;
  // Per author: open PRs and titles of work merged in 14 days
  authors?: TeamCode['authors'];
}

// Review state is not in the REST pull list; one GraphQL call per repo
// gets it for every open PR
const REVIEWS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number
        reviewDecision
        author { login }
        reviews(first: 30, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]) {
          nodes { author { __typename login } }
        }
        timelineItems(itemTypes: [READY_FOR_REVIEW_EVENT], last: 1) {
          nodes { ... on ReadyForReviewEvent { createdAt } }
        }
      }
    }
  }
}`;

interface ReviewNode {
  number: number;
  reviewDecision: string | null;
  author?: { login?: string } | null;
  reviews?: {
    nodes?: Array<{ author?: { __typename?: string; login?: string } | null }>;
  };
  timelineItems?: { nodes?: Array<{ createdAt?: string }> };
}

// Reviews that count as "someone looked": not by the author, not by a bot
export const humanReviews = (node: ReviewNode): number =>
  (node.reviews?.nodes ?? []).filter((r) => {
    const who = r.author;
    if (!who?.login) return false;
    if (who.__typename === 'Bot' || who.login.endsWith('[bot]')) return false;
    return who.login !== node.author?.login;
  }).length;

const reviewLabel = (review?: ReviewNode): string => {
  if (!review) return '';
  if (review.reviewDecision) return `${review.reviewDecision} | `;
  return humanReviews(review) ? 'reviewed | ' : 'no review yet | ';
};

const daysSince = (iso: string, now: Date): number =>
  Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);

@Injectable()
export class GitHubActivityReader implements IProjectSource {
  readonly source = 'code' as const;
  private readonly token: string;
  private readonly org: string;
  private readonly repos: string[];
  private readonly compares: Compare[];

  constructor(config: ConfigService) {
    this.token = config.get<string>('PM_GITHUB_TOKEN') ?? '';
    this.org = config.get<string>('PM_GITHUB_ORG') ?? '';
    this.repos = (config.get<string>('PM_GITHUB_REPOS') ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    // e.g. "api-repo:main...staging" — how far prod lags the next tier
    this.compares = (config.get<string>('PM_GITHUB_COMPARES') ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => /^[\w.-]+:[\w./-]+\.\.\.[\w./-]+$/.test(c))
      .map((spec) => ({ spec }));
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.org && this.repos.length);
  }

  async fetch(now = new Date()): Promise<SourceResult> {
    const activity = await Promise.all(
      this.repos.map((repo) =>
        this.repo(repo, now).catch(
          (error): RepoActivity => ({
            text: `## ${repo}: could not read (${(error as Error).message})`,
            pulls: [],
            runs: [],
            failed: true,
          }),
        ),
      ),
    );
    const missing = this.repos.filter((_, i) => activity[i].failed);
    const numbers: Record<string, number> = {};
    const repoParts = [
      `## Computed metrics (exact; computed ${now
        .toISOString()
        .slice(0, 16)} UTC)\n${codeMetrics(
        activity.flatMap((a) => a.pulls),
        activity.flatMap((a) => a.runs),
        now,
        missing,
        numbers,
      )}`,
      ...activity.map((a) => a.text),
    ];
    const compared = await Promise.all(
      this.compares.map((c) =>
        this.compare(c.spec).catch((error) => ({
          text: `${c.spec}: could not compare (${(error as Error).message})`,
          ahead: null as number | null,
        })),
      ),
    );
    const drift = compared.map((c) => c.text);
    const aheads = compared
      .map((c) => c.ahead)
      .filter((n): n is number => n !== null);
    if (aheads.length === compared.length && aheads.length) {
      numbers.driftAhead = Math.max(...aheads);
    }
    const text = [
      ...repoParts,
      drift.length
        ? `## Branch drift (commits ahead)\n${drift.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    // Partial numbers would read as a trend (PRs "dropped"); keep none
    // Merge per-author work across repos for the admin page
    const allAuthors: TeamCode['authors'] = {};
    for (const a of activity) {
      for (const [login, w] of Object.entries(a.authors ?? {})) {
        const t = (allAuthors[login] ??= { open: [], merged14: [] });
        t.open.push(...w.open);
        t.merged14.push(...w.merged14);
      }
    }
    const details = { authors: allAuthors } as unknown as Record<
      string,
      unknown
    >;
    const signals = codeSignals(
      activity.flatMap((a) => a.pulls),
      activity.flatMap((a) => a.runs),
      now,
    );
    return missing.length
      ? { text, signals, details }
      : { text, metrics: numbers, signals, details };
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // Unknown (undefined) on any failure: the metrics then say so instead of
  // reporting "no reviews"
  private async reviews(repo: string): Promise<Map<number, ReviewNode>> {
    const { data } = await getJson<{
      data?: {
        repository?: { pullRequests?: { nodes?: ReviewNode[] } } | null;
      } | null;
    }>(`${API}/graphql`, this.headers, {
      method: 'POST',
      body: {
        query: REVIEWS_QUERY,
        variables: { owner: this.org, name: repo },
      },
    });
    const nodes = data.data?.repository?.pullRequests?.nodes;
    if (!nodes) throw new Error('no review data');
    return new Map(nodes.map((n) => [n.number, n]));
  }

  private async repo(repo: string, now: Date): Promise<RepoActivity> {
    const base = `${API}/repos/${this.org}/${repo}`;
    const since = new Date(now.getTime() - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [open, closed, runs, reviews] = await Promise.all([
      getJson<Pull[]>(`${base}/pulls?state=open&per_page=50`, this.headers),
      getJson<Pull[]>(
        `${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
        this.headers,
      ),
      getJson<{ workflow_runs: Run[] }>(
        `${base}/actions/runs?per_page=40&exclude_pull_requests=true`,
        this.headers,
      ),
      this.reviews(repo).catch(() => null),
    ]);

    const pulls: PullFact[] = open.data.map((pr) => {
      const review = reviews?.get(pr.number);
      return {
        repo,
        number: pr.number,
        author: pr.user?.login ?? '?',
        draft: Boolean(pr.draft),
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        ...(review
          ? {
              reviewDecision: review.reviewDecision,
              reviews: humanReviews(review),
              readyAt: review.timelineItems?.nodes?.[0]?.createdAt ?? null,
            }
          : {}),
      };
    });
    const runFacts: RunFact[] = (runs.data.workflow_runs ?? []).map((run) => ({
      repo,
      workflow: run.name ?? '?',
      branch: run.head_branch ?? '?',
      conclusion: run.conclusion ?? null,
      createdAt: run.created_at,
    }));

    const openLines = open.data.map(
      (pr) =>
        `#${pr.number} ${pr.draft ? 'DRAFT ' : ''}| ${
          pr.user?.login ?? '?'
        } | ` +
        `${pr.head.ref} → ${pr.base.ref} | open ${daysSince(
          pr.created_at,
          now,
        )}d | ` +
        reviewLabel(reviews?.get(pr.number)) +
        oneLine(pr.title, 120),
    );
    const merged = closed.data.filter(
      (pr) => pr.merged_at && pr.merged_at.slice(0, 10) >= since,
    );
    const work = merged.filter((pr) => !PROMOTION_HEADS.has(pr.head.ref));
    const promotions = merged.filter((pr) => PROMOTION_HEADS.has(pr.head.ref));
    const authors: TeamCode['authors'] = {};
    const author = (login: string) =>
      (authors[login] ??= { open: [], merged14: [] });
    for (const pr of open.data) {
      const review = reviews?.get(pr.number);
      const decision = review?.reviewDecision;
      author(pr.user?.login ?? '?').open.push({
        repo,
        number: pr.number,
        title: oneLine(pr.title, 120),
        draft: Boolean(pr.draft),
        waitingDays: workingDaysBetween(
          new Date(
            review?.timelineItems?.nodes?.[0]?.createdAt || pr.created_at,
          ),
          now,
        ),
        review: !review
          ? 'unknown'
          : decision
          ? decision
          : humanReviews(review)
          ? 'reviewed'
          : 'no review yet',
      });
    }
    const byAuthor = new Map<string, number>();
    work.forEach((pr) => {
      const who = pr.user?.login ?? '?';
      byAuthor.set(who, (byAuthor.get(who) ?? 0) + 1);
      author(who).merged14.push(
        `${repo}#${pr.number} ${oneLine(pr.title, 100)}`,
      );
    });

    // Latest run per workflow+branch, outside pull requests
    const latest = new Map<string, Run>();
    for (const run of runs.data.workflow_runs ?? []) {
      const key = `${run.name}@${run.head_branch}`;
      if (!latest.has(key)) latest.set(key, run);
    }
    const runLines = [...latest.entries()].map(
      ([key, run]) =>
        `${key}: ${run.conclusion ?? run.status} (${shortDate(
          run.created_at,
        )})`,
    );

    const text = [
      `## ${repo}`,
      `Open PRs (${open.data.length}):`,
      ...(openLines.length ? openLines : ['none']),
      `Merged since ${since}: ${work.length} work PRs (${
        [...byAuthor].map(([who, n]) => `${who} ${n}`).join(', ') || 'none'
      })`,
      ...work
        .slice(0, 40)
        .map(
          (pr) =>
            `  #${pr.number} ${shortDate(pr.merged_at)} ${
              pr.user?.login ?? '?'
            }: ${oneLine(pr.title, 100)}`,
        ),
      promotions.length
        ? `Branch promotions: ${promotions
            .map(
              (pr) =>
                `${pr.head.ref}→${pr.base.ref} #${pr.number} ${shortDate(
                  pr.merged_at,
                )}`,
            )
            .join('; ')}`
        : 'Branch promotions: none in 14 days',
      'Latest CI/CD runs (non-PR):',
      ...(runLines.length ? runLines : ['none']),
    ].join('\n');
    return { text, pulls, runs: runFacts, authors };
  }

  private async compare(
    spec: string,
  ): Promise<{ text: string; ahead: number | null }> {
    const [repo, range] = spec.split(':');
    const { data } = await getJson<{
      ahead_by: number;
      behind_by: number;
      status: string;
    }>(`${API}/repos/${this.org}/${repo}/compare/${range}`, this.headers);
    const [baseRef, headRef] = range.split('...');
    return {
      text: `${repo}: ${headRef} is ${data.ahead_by} commits ahead of ${baseRef} (${data.behind_by} behind)`,
      ahead: data.ahead_by,
    };
  }
}
