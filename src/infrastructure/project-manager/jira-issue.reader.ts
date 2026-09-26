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
import { ReleaseIssues } from '@application/project-manager/release';
import {
  FLOW_WINDOW_DAYS,
  FlowStages,
  flowStages,
  IssueHistory,
  parseStatusMap,
  Stage,
  stageFor,
} from '@application/project-manager/stages';
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
  id?: string;
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

// A missing "toString" key would read Object.prototype.toString
const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

interface Query {
  title: string;
  jql: string;
  limit: number;
  fields?: string[];
}

// Only what the weekly counts need: these lists never reach the prompt
const HISTORY_FIELDS = [
  'status',
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
  private readonly statusMap: Record<string, Stage>;
  private readonly scope: string;

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
    this.scope = scope;
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
    this.statusMap = parseStatusMap(config.get<string>('PM_STATUS_MAP'));
    const weeks = `-${FLOW_WEEKS * 7}d`;
    this.history = scope
      ? [
          {
            title: 'done history',
            // By when it was closed, not updated: a bulk edit of old
            // tickets must not fill the limit
            jql: `${scope} AND statusCategory = Done AND (resolved >= ${weeks} OR statusCategoryChangedDate >= ${weeks}) ORDER BY created DESC`,
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
    // The changelog knows the real last status change; the category date
    // only moves on To Do → In Progress → Done
    const history = await this.historyLists();
    const closed = [...(history?.done ?? []), ...done].filter(
      (i, n, all) => all.findIndex((x) => x.key === i.key) === n,
    );
    const stages = await this.stages(open, closed, now);
    const openFacts = open.map((i) => {
      const f = toFact(i);
      const changed = stages?.lastChange[i.key];
      return changed ? { ...f, statusSince: changed } : f;
    });
    const numbers: Record<string, number> = {};
    const metrics = issueMetrics(
      openFacts,
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
    const signals = issueSignals(openFacts, this.releaseVersion);
    const details = {
      ...teamIssues(
        openFacts,
        done.map(toFact),
        now,
        this.releaseVersion,
        caps.some(Boolean),
        { stage: this.stageName },
      ),
      flow: history ? this.flow(history, now) : null,
      stages,
      release: await this.release(),
    } as unknown as Record<string, unknown>;
    return caps.some(Boolean)
      ? { text, signals, details }
      : { text, metrics: numbers, signals, details };
  }

  private readonly stageName = (status: string, category?: string) =>
    stageFor(
      status,
      category as IssueHistory['category'] | undefined,
      this.statusMap,
    ).stage;

  // 12 weeks of closed and created work; a failure only leaves the charts
  // and the stage numbers on the 14-day list
  private async historyLists(): Promise<{
    done: JiraIssue[];
    created: JiraIssue[];
    capped: boolean;
  } | null> {
    if (this.history.length < 2) return null;
    try {
      const [done, created] = await Promise.all(
        this.history.map((q) => this.search(q)),
      );
      return {
        done,
        created,
        capped:
          done.length >= this.history[0].limit ||
          created.length >= this.history[1].limit,
      };
    } catch {
      return null;
    }
  }

  private flow(
    history: { done: JiraIssue[]; created: JiraIssue[]; capped: boolean },
    now: Date,
  ): WeeklyFlow {
    return weeklyFlow(
      history.done.map(toFact),
      history.created.map(toFact),
      now,
      history.capped,
    );
  }

  // Status and assignee history of open work and of work closed in the
  // last 30 days, from the bulk changelog API (status and assignee only)
  private async stages(
    open: JiraIssue[],
    done: JiraIssue[],
    now: Date,
  ): Promise<FlowStages | null> {
    const since = now.getTime() - FLOW_WINDOW_DAYS * 86_400_000;
    const recent = done.filter((i) => {
      const at = toFact(i).doneAt;
      return at && new Date(at).getTime() >= since;
    });
    const issues = [...open, ...recent].filter(
      (i, n, all) => all.findIndex((x) => x.key === i.key) === n,
    );
    if (!issues.length) return null;
    try {
      const logs = await this.changelogs(issues.map((i) => i.key));
      const byId = new Map(issues.map((i) => [i.id ?? i.key, i]));
      const histories: IssueHistory[] = issues.map((i) => {
        const f = toFact(i);
        return {
          key: i.key,
          assignee: f.assignee,
          created: f.created,
          status: f.status,
          category: f.category,
          doneAt: f.doneAt,
          statusChanges: [],
          assigneeChanges: [],
        };
      });
      const byKey = new Map(histories.map((h) => [h.key, h]));
      for (const log of logs) {
        const issue = byId.get(log.issueId);
        const h = issue ? byKey.get(issue.key) : undefined;
        if (!h) continue;
        for (const change of log.changeHistories ?? []) {
          for (const item of change.items ?? []) {
            if (item.fieldId === 'status' || item.field === 'status')
              h.statusChanges.push({
                at: change.created,
                from: str(item.fromString) ?? '',
                to: str(item.toString) ?? '',
              });
            else if (item.fieldId === 'assignee' || item.field === 'assignee')
              h.assigneeChanges.push({
                at: change.created,
                from: str(item.fromString),
                to: str(item.toString),
              });
          }
        }
      }
      return flowStages(histories, this.statusMap, now);
    } catch {
      return null;
    }
  }

  // Every ticket of the release version, any status, with when the version
  // was put on it; a failure leaves the Релиз page empty
  private async release(): Promise<ReleaseIssues | null> {
    if (!this.releaseVersion || !this.scope) return null;
    // JQL string: backslash and quote escaped, not dropped
    const version = this.releaseVersion
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    try {
      const limit = 500;
      const issues = await this.search({
        title: 'release',
        jql: `${this.scope} AND fixVersion = "${version}" ORDER BY created ASC`,
        limit,
      });
      const added = new Map<string, string>();
      try {
        const logs = await this.changelogs(
          issues.map((i) => i.key),
          ['fixVersions'],
        );
        const keyOf = new Map(issues.map((i) => [i.id ?? i.key, i.key]));
        for (const log of logs) {
          const key = keyOf.get(log.issueId);
          if (!key) continue;
          for (const change of log.changeHistories ?? [])
            for (const item of change.items ?? [])
              if (str(item.toString) === this.releaseVersion) {
                const prev = added.get(key);
                if (!prev || Date.parse(change.created) > Date.parse(prev))
                  added.set(key, change.created);
              }
        }
      } catch {
        // Without the changelog "added" falls back to created
      }
      return {
        version: this.releaseVersion,
        capped: issues.length >= limit,
        issues: issues.map((i) => {
          const f = toFact(i);
          return {
            key: f.key,
            summary: f.summary.slice(0, 140),
            type: f.type,
            status: f.status,
            category: f.category,
            priority: f.priority,
            assignee: f.assignee,
            reporter: i.fields.reporter?.displayName ?? null,
            created: f.created,
            doneAt: f.category === 'done' ? f.doneAt : null,
            statusSince: f.statusSince,
            blockedBy: f.blockedBy ?? [],
            addedAt: added.get(f.key) ?? f.created,
          };
        }),
      };
    } catch {
      return null;
    }
  }

  private async changelogs(
    keys: string[],
    fieldIds = ['status', 'assignee'],
  ): Promise<
    Array<{
      issueId: string;
      changeHistories?: Array<{
        created: string;
        items?: Array<{
          field?: string;
          fieldId?: string;
          fromString?: string | null;
          toString?: string | null;
        }>;
      }>;
    }>
  > {
    const out: Awaited<ReturnType<JiraIssueReader['changelogs']>> = [];
    for (let at = 0; at < keys.length; at += 1000) {
      let nextPageToken: string | undefined;
      let pages = 0;
      do {
        const { data } = await getJson<{
          issueChangeLogs?: typeof out;
          nextPageToken?: string;
        }>(
          `${this.baseUrl}/rest/api/3/changelog/bulkfetch`,
          { Authorization: this.auth },
          {
            method: 'POST',
            body: {
              issueIdsOrKeys: keys.slice(at, at + 1000),
              fieldIds,
              maxResults: 1000,
              ...(nextPageToken ? { nextPageToken } : {}),
            },
          },
        );
        out.push(...(data.issueChangeLogs ?? []));
        nextPageToken = data.nextPageToken;
        pages += 1;
      } while (nextPageToken && pages < 20);
    }
    return out;
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
