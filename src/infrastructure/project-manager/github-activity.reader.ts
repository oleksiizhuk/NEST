import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IProjectSource } from '@application/project-manager/project-source.interface';
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

  async fetch(now = new Date()): Promise<string> {
    const repoParts = await Promise.all(
      this.repos.map((repo) =>
        this.repo(repo, now).catch(
          (error) => `## ${repo}: could not read (${(error as Error).message})`,
        ),
      ),
    );
    const drift = await Promise.all(
      this.compares.map((c) =>
        this.compare(c.spec).catch(
          (error) =>
            `${c.spec}: could not compare (${(error as Error).message})`,
        ),
      ),
    );
    return [
      ...repoParts,
      drift.length
        ? `## Branch drift (commits ahead)\n${drift.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async repo(repo: string, now: Date): Promise<string> {
    const base = `${API}/repos/${this.org}/${repo}`;
    const since = new Date(now.getTime() - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const [open, closed, runs] = await Promise.all([
      getJson<Pull[]>(`${base}/pulls?state=open&per_page=50`, this.headers),
      getJson<Pull[]>(
        `${base}/pulls?state=closed&sort=updated&direction=desc&per_page=100`,
        this.headers,
      ),
      getJson<{ workflow_runs: Run[] }>(
        `${base}/actions/runs?per_page=40&exclude_pull_requests=true`,
        this.headers,
      ),
    ]);

    const openLines = open.data.map(
      (pr) =>
        `#${pr.number} ${pr.draft ? 'DRAFT ' : ''}| ${
          pr.user?.login ?? '?'
        } | ` +
        `${pr.head.ref} → ${pr.base.ref} | open ${daysSince(
          pr.created_at,
          now,
        )}d | ` +
        oneLine(pr.title, 120),
    );
    const merged = closed.data.filter(
      (pr) => pr.merged_at && pr.merged_at.slice(0, 10) >= since,
    );
    const work = merged.filter((pr) => !PROMOTION_HEADS.has(pr.head.ref));
    const promotions = merged.filter((pr) => PROMOTION_HEADS.has(pr.head.ref));
    const byAuthor = new Map<string, number>();
    work.forEach((pr) => {
      const who = pr.user?.login ?? '?';
      byAuthor.set(who, (byAuthor.get(who) ?? 0) + 1);
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

    return [
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
  }

  private async compare(spec: string): Promise<string> {
    const [repo, range] = spec.split(':');
    const { data } = await getJson<{
      ahead_by: number;
      behind_by: number;
      status: string;
    }>(`${API}/repos/${this.org}/${repo}/compare/${range}`, this.headers);
    const [baseRef, headRef] = range.split('...');
    return `${repo}: ${headRef} is ${data.ahead_by} commits ahead of ${baseRef} (${data.behind_by} behind)`;
  }
}
