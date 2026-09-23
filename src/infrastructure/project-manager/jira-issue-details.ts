/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IIssueDetails,
  Remark,
} from '@application/project-manager/collaboration.interface';
import {
  basicAuth,
  getJson,
  shortDate,
} from '@infrastructure/project-manager/http-json';
import { adfToText } from '@infrastructure/project-manager/adf-to-text';

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;

@Injectable()
export class JiraIssueDetails implements IIssueDetails {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly projects: string[];

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
    this.projects = (config.get<string>('PM_JIRA_PROJECTS') ?? '')
      .split(',')
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.projects.length);
  }

  private headers() {
    return { Authorization: this.auth };
  }

  async getIssue(key: string): Promise<string> {
    const k = String(key ?? '')
      .trim()
      .toUpperCase();
    if (!KEY.test(k) || !this.projects.includes(k.split('-')[0])) {
      throw new Error(
        `Only issues of ${this.projects.join(', ')} can be read (got "${key}")`,
      );
    }
    const fields =
      'summary,description,status,issuetype,priority,assignee,reporter,labels,parent,issuelinks,subtasks,attachment,fixVersions,created,updated,resolutiondate';
    const [{ data: issue }, { data: comments }] = await Promise.all([
      getJson<any>(
        `${this.baseUrl}/rest/api/3/issue/${k}?fields=${fields}&expand=changelog`,
        this.headers(),
      ),
      getJson<any>(
        `${this.baseUrl}/rest/api/3/issue/${k}/comment?orderBy=-created&maxResults=12`,
        this.headers(),
      ),
    ]);
    const f = issue.fields ?? {};
    const links = (f.issuelinks ?? [])
      .map((l: any) =>
        l.inwardIssue
          ? `${l.type?.inward} ${l.inwardIssue.key} (${
              l.inwardIssue.fields?.status?.name ?? '?'
            })`
          : l.outwardIssue
          ? `${l.type?.outward} ${l.outwardIssue.key} (${
              l.outwardIssue.fields?.status?.name ?? '?'
            })`
          : '',
      )
      .filter(Boolean);
    // expand=changelog returns at most the first 100 entries; for a long
    // ticket fetch the newest page so "recent changes" really are recent
    let histories: any[] = issue.changelog?.histories ?? [];
    const total: number = issue.changelog?.total ?? histories.length;
    if (total > histories.length) {
      const { data: page } = await getJson<any>(
        `${this.baseUrl}/rest/api/3/issue/${k}/changelog?startAt=${Math.max(
          0,
          total - 50,
        )}&maxResults=50`,
        this.headers(),
      ).catch(() => ({ data: { values: [] as any[] } }));
      if (page.values?.length) histories = page.values;
    }
    histories = [...histories].sort(
      (a: any, b: any) =>
        new Date(a.created).getTime() - new Date(b.created).getTime(),
    );
    const transitions = histories
      .flatMap((h: any) =>
        (h.items ?? [])
          .filter((i: any) => i.field === 'status' || i.field === 'assignee')
          .map(
            (i: any) =>
              `${shortDate(h.created)} ${h.author?.displayName ?? '?'}: ${
                i.field
              } ${i.fromString ?? '—'} → ${i.toString ?? '—'}`,
          ),
      )
      .slice(-10);
    const commentLines = (comments.comments ?? [])
      .slice()
      .reverse()
      .map(
        (c: any) =>
          `- ${shortDate(c.created)} ${
            c.author?.displayName ?? '?'
          }: ${adfToText(c.body, 800).replace(/\n/g, ' / ')}`,
      );
    return [
      `${k} · ${f.issuetype?.name ?? '?'} · ${
        f.status?.name ?? '?'
      } · priority ${f.priority?.name ?? '-'}`,
      `Summary: ${f.summary ?? ''}`,
      `Assignee: ${f.assignee?.displayName ?? 'UNASSIGNED'} · Reporter: ${
        f.reporter?.displayName ?? '?'
      }${f.parent?.key ? ` · parent ${f.parent.key}` : ''}`,
      f.fixVersions?.length
        ? `Fix versions: ${f.fixVersions.map((v: any) => v.name).join(', ')}`
        : '',
      f.labels?.length ? `Labels: ${f.labels.join(', ')}` : '',
      links.length ? `Links: ${links.join('; ')}` : '',
      f.subtasks?.length
        ? `Subtasks: ${f.subtasks
            .map((s: any) => `${s.key} (${s.fields?.status?.name ?? '?'})`)
            .join(', ')}`
        : '',
      f.attachment?.length
        ? `Attachments: ${f.attachment.map((a: any) => a.filename).join(', ')}`
        : '',
      `Created ${shortDate(f.created)} · updated ${shortDate(f.updated)}${
        f.resolutiondate ? ` · resolved ${shortDate(f.resolutiondate)}` : ''
      }`,
      'Description:',
      f.description ? adfToText(f.description, 6000) : '(empty)',
      `Recent status/assignee changes:${
        transitions.length ? '\n' + transitions.join('\n') : ' none'
      }`,
      `Comments (${comments.total ?? commentLines.length}, newest ${
        commentLines.length
      } shown oldest first):`,
      ...(commentLines.length ? commentLines : ['none']),
    ]
      .filter(Boolean)
      .join('\n');
  }

  async recentComments(days: number): Promise<Remark[]> {
    const scope = `project in (${this.projects.join(', ')})`;
    const { data } = await getJson<any>(
      `${this.baseUrl}/rest/api/3/search/jql`,
      this.headers(),
      {
        method: 'POST',
        body: {
          jql: `${scope} AND updated >= -${Math.max(
            1,
            Math.min(60, days),
          )}d ORDER BY updated DESC`,
          fields: ['summary', 'status', 'comment'],
          maxResults: 60,
        },
        timeoutMs: 40_000,
      },
    );
    const since = Date.now() - days * 86_400_000;
    const remarks: Remark[] = [];
    for (const issue of data.issues ?? []) {
      const all = (issue.fields?.comment?.comments ?? []).map((c: any) => ({
        author: c.author?.displayName ?? '?',
        createdAt: new Date(c.created),
        text: adfToText(c.body, 400),
      }));
      const done = issue.fields?.status?.statusCategory?.key === 'done';
      all.forEach((c: any, i: number) => {
        if (c.createdAt.getTime() < since) return;
        remarks.push({
          source: 'jira',
          where: `${issue.key} ${issue.fields?.summary ?? ''}`.slice(0, 120),
          link: `${this.baseUrl}/browse/${issue.key}`,
          author: c.author,
          createdAt: c.createdAt,
          text: c.text,
          // A later comment on the same issue counts as a reply
          replies: all
            .slice(i + 1)
            .map((r: any) => ({ author: r.author, createdAt: r.createdAt })),
          resolved: done,
        });
      });
    }
    return remarks;
  }
}
