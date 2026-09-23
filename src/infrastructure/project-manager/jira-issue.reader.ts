import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IProjectSource } from '@application/project-manager/project-source.interface';
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
  'duedate',
  'labels',
  'parent',
  'issuelinks',
  'created',
  'updated',
  'resolutiondate',
];
const PAGE_SIZE = 100;

interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string };
    assignee?: { displayName?: string } | null;
    duedate?: string | null;
    labels?: string[];
    parent?: { key?: string } | null;
    issuelinks?: Array<{
      type?: { inward?: string; outward?: string };
      inwardIssue?: { key: string; fields?: { status?: { name?: string } } };
      outwardIssue?: { key: string; fields?: { status?: { name?: string } } };
    }>;
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
  };
}

interface Query {
  title: string;
  jql: string;
  limit: number;
}

// One line per issue keeps a few hundred issues within a small token budget.
export const formatIssue = (issue: JiraIssue): string => {
  const f = issue.fields;
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
    f.parent?.key ? `parent ${f.parent.key}` : '',
    f.labels?.length ? `labels ${f.labels.join(',')}` : '',
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
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.queries.length);
  }

  async fetch(): Promise<string> {
    const parts: string[] = [];
    for (const query of this.queries) {
      const issues = await this.search(query);
      const more =
        issues.length >= query.limit ? ` (capped at ${query.limit})` : '';
      parts.push(
        `## ${query.title}: ${issues.length}${more}\n` +
          'key | status | type | priority | assignee | … | summary\n' +
          issues.map(formatIssue).join('\n'),
      );
    }
    return parts.join('\n\n');
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
            fields: FIELDS,
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
