import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IProjectSource,
  SourceResult,
} from '@application/project-manager/project-source.interface';
import {
  IssueFact,
  issueMetrics,
  issueSignals,
} from '@application/project-manager/metrics';
import { teamIssues } from '@application/project-manager/team';
import {
  FLOW_WEEKS,
  WeeklyFlow,
  weeklyFlow,
} from '@application/project-manager/load';
import {
  basicAuth,
  getJson,
  oneLine,
  shortDate,
} from '@infrastructure/project-manager/http-json';

const FIELDS = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'duedate',
  'labels',
  'parent',
  'issuelinks',
  'created',
  'updated',
  'resolutiondate',
  'fixVersions',
  'components',
  'statuscategorychangedate',
];
// Jira Cloud's usual Sprint field; override when the site uses another id
const DEFAULT_SPRINT_FIELD = 'customfield_10020';
const PAGE_SIZE = 100;

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    duedate?: string | null;
    labels?: string[];
    parent?: { key?: string } | null;
    issuelinks?: Array<{
      type?: { inward?: string; outward?: string };
      inwardIssue?: {
        key: string;
        fields?: {
          status?: { name?: string; statusCategory?: { key?: string } };
        };
      };
      outwardIssue?: { key: string; fields?: { status?: { name?: string } } };
    }>;
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
    fixVersions?: Array<{ name?: string }>;
    components?: Array<{ name?: string }>;
    statuscategorychangedate?: string | null;
    [custom: string]: unknown;
  };
}

// Sprint values are objects with name/state; the active one (else the last)
export const sprintOf = (value: unknown): string | null => {
  if (!Array.isArray(value) || !value.length) return null;
  const sprints = value.filter(
    (v): v is { name?: string; state?: string } =>
      typeof v === 'object' && v !== null,
  );
  const pick =
    sprints.find((v) => v.state === 'active') ?? sprints[sprints.length - 1];
  return pick?.name ?? null;
};

const names = (list?: Array<{ name?: string }>): string[] =>
  (list ?? []).map((v) => v.name ?? '').filter(Boolean);

export const toFact = (issue: JiraIssue): IssueFact => {
  const f = issue.fields;
  const category = f.status?.statusCategory?.key;
  const blockedBy = (f.issuelinks ?? [])
    .filter(
      (l) =>
        /blocked by/i.test(l.type?.inward ?? '') &&
        l.inwardIssue &&
        // Status category, not the name: names are localized and custom
        l.inwardIssue.fields?.status?.statusCategory?.key !== 'done',
    )
    .map((l) => l.inwardIssue?.key ?? '')
    .filter(Boolean);
  return {
    key: issue.key,
    summary: f.summary ?? '',
    blockedBy,
    type: f.issuetype?.name ?? '?',
    status: f.status?.name ?? '?',
    category:
      category === 'done' || category === 'indeterminate' ? category : 'new',
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    fixVersions: names(f.fixVersions),
    created: f.created ?? null,
    doneAt: f.resolutiondate ?? f.statuscategorychangedate ?? null,
    statusSince: f.statuscategorychangedate ?? null,
    due: f.duedate ?? null,
  };
};

interface Query {
  title: string;
  jql: string;
  limit: number;
  fields?: string[];
}

// Only what the weekly counts need: these lists never reach the prompt
const HISTORY_FIELDS = [
  'issuetype',
  'assignee',
  'created',
  'resolutiondate',
  'statuscategorychangedate',
];

// One line per issue keeps a few hundred issues within a small token budget.
export const formatIssue = (
  issue: JiraIssue,
  sprintField = DEFAULT_SPRINT_FIELD,
): string => {
  const f = issue.fields;
  const fix = names(f.fixVersions);
  const components = names(f.components);
  const sprint = sprintOf(f[sprintField]);
  const links = (f.issuelinks ?? [])
    .map((link) => {
      if (link.inwardIssue) {
        return `${link.type?.inward ?? 'linked'} ${link.inwardIssue.key}(${
          link.inwardIssue.fields?.status?.name ?? '?'
        })`;
      }
      if (link.outwardIssue) {
        return `${link.type?.outward ?? 'linked'} ${link.outwardIssue.key}(${
          link.outwardIssue.fields?.status?.name ?? '?'
        })`;
      }
      return '';
    })
    .filter(Boolean);
  return [
    issue.key,
    f.status?.name ?? '?',
    f.issuetype?.name ?? '?',
    f.priority?.name ?? '-',
    f.assignee?.displayName ?? 'UNASSIGNED',
    f.reporter?.displayName ? `by ${f.reporter.displayName}` : '',
    f.parent?.key ? `parent ${f.parent.key}` : '',
    f.labels?.length ? `labels ${f.labels.join(',')}` : '',
    fix.length ? `fix ${fix.join(',')}` : '',
    components.length ? `comp ${components.join(',')}` : '',
    sprint ? `sprint ${sprint}` : '',
    f.duedate ? `due ${f.duedate}` : '',
    `created ${shortDate(f.created)}`,
    `updated ${shortDate(f.updated)}`,
    f.resolutiondate ? `resolved ${shortDate(f.resolutiondate)}` : '',
    links.length ? links.join('; ') : '',
    oneLine(f.summary, 140),
  ]
    .filter(Boolean)
    .join(' | ');
};

@Injectable()
export class JiraIssueReader implements IProjectSource {
  readonly source = 'issues' as const;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly queries: Query[];
  private readonly sprintField: string;
  private readonly releaseDate: string | null;
  private readonly releaseVersion: string | null;
  private readonly history: Query[];

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('PM_ATLASSIAN_BASE_URL') ||
      config.get<string>('JIRA_BASE_URL') ||
      ''
    ).replace(/\/$/, '');
    this.auth = basicAuth(
      config.get<string>('JIRA_EMAIL') ?? '',
      config.get<string>('JIRA_API_TOKEN') ?? '',
    );
    const sprintField = (
      config.get<string>('PM_JIRA_SPRINT_FIELD') ?? ''
    ).trim();
    this.sprintField = /^customfield_\d+$/.test(sprintField)
      ? sprintField
      : DEFAULT_SPRINT_FIELD;
    const releaseDate = (config.get<string>('PM_RELEASE_DATE') ?? '').trim();
    this.releaseDate = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
      ? releaseDate
      : null;
    this.releaseVersion =
      (config.get<string>('PM_RELEASE_VERSION') ?? '').trim() || null;
    const projects = (config.get<string>('PM_JIRA_PROJECTS') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const scope = projects.length ? `project in (${projects.join(', ')})` : '';
    this.queries = scope
      ? [
          {
            title: 'Open issues',
            // statusCategory, not resolution: some workflows reach Done
            // without setting a resolution
            jql: `${scope} AND statusCategory != Done ORDER BY status ASC, priority DESC, updated DESC`,
            limit: 400,
          },
          {
            title: 'Done in the last 14 days',
            jql: `${scope} AND statusCategory = Done AND updated >= -14d ORDER BY updated DESC`,
            limit: 150,
          },
        ]
      : [];
    const weeks = `-${FLOW_WEEKS * 7}d`;
    this.history = scope
      ? [
          {
            title: 'done history',
            jql: `${scope} AND statusCategory = Done AND updated >= ${weeks} ORDER BY updated DESC`,
            limit: 1000,
            fields: HISTORY_FIELDS,
          },
          {
            title: 'created history',
            jql: `${scope} AND created >= ${weeks} ORDER BY created DESC`,
            limit: 1000,
            fields: HISTORY_FIELDS,
          },
        ]
      : [];
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.queries.length);
  }

  async fetch(now = new Date()): Promise<SourceResult> {
    const parts: string[] = [];
    const results: JiraIssue[][] = [];
    const caps: boolean[] = [];
    for (const query of this.queries) {
      const issues = await this.search(query);
      results.push(issues);
      const hitCap = issues.length >= query.limit;
      caps.push(hitCap);
      const more = hitCap ? ` (capped at ${query.limit})` : '';
      parts.push(
        `## ${query.title}: ${issues.length}${more}\n` +
          'key | status | type | priority | assignee | by reporter | … | summary\n' +
          issues.map((i) => formatIssue(i, this.sprintField)).join('\n'),
      );
    }
    const [open = [], done = []] = results;
    const numbers: Record<string, number> = {};
    const metrics = issueMetrics(
      open.map(toFact),
      done.map(toFact),
      now,
      {
        releaseDate: this.releaseDate,
        releaseVersion: this.releaseVersion,
        openCapped: caps[0] ?? false,
        doneCapped: caps[1] ?? false,
      },
      numbers,
    );
    const text = [
      `## Computed metrics (exact, from the lists below; computed ${now
        .toISOString()
        .slice(0, 16)} UTC)\n${metrics}`,
      ...parts,
    ].join('\n\n');
    // Counts from a capped list are lower bounds; as a trend they would read
    // as "no change" while scope grows
    const signals = issueSignals(open.map(toFact), this.releaseVersion);
    const details = {
      ...teamIssues(
        open.map(toFact),
        done.map(toFact),
        now,
        this.releaseVersion,
        caps.some(Boolean),
      ),
      flow: await this.flow(now),
    } as unknown as Record<string, unknown>;
    return caps.some(Boolean)
      ? { text, signals, details }
      : { text, metrics: numbers, signals, details };
  }

  // Weekly history; a failure only leaves the charts empty
  private async flow(now: Date): Promise<WeeklyFlow | null> {
    if (this.history.length < 2) return null;
    try {
      const [done, created] = await Promise.all(
        this.history.map((q) => this.search(q)),
      );
      return weeklyFlow(
        done.map(toFact),
        created.map(toFact),
        now,
        done.length >= this.history[0].limit ||
          created.length >= this.history[1].limit,
      );
    } catch {
      return null;
    }
  }

  private async search(query: Query): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const { data } = await getJson<{
        issues: JiraIssue[];
        nextPageToken?: string;
        isLast?: boolean;
      }>(
        `${this.baseUrl}/rest/api/3/search/jql`,
        { Authorization: this.auth },
        {
          method: 'POST',
          body: {
            jql: query.jql,
            fields: query.fields ?? [...FIELDS, this.sprintField],
            maxResults: PAGE_SIZE,
            ...(nextPageToken ? { nextPageToken } : {}),
          },
        },
      );
      issues.push(...(data.issues ?? []));
      nextPageToken = data.isLast === false ? data.nextPageToken : undefined;
    } while (nextPageToken && issues.length < query.limit);
    return issues.slice(0, query.limit);
  }
}
