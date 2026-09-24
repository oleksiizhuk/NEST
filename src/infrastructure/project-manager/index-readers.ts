/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IIndexReader,
  IndexDoc,
} from '@application/project-manager/project-index.interface';
import { redactSecrets } from '@application/project-manager/tools/untrusted';
import {
  basicAuth,
  getJson,
  oneLine,
} from '@infrastructure/project-manager/http-json';
import { adfToText } from '@infrastructure/project-manager/adf-to-text';
import { storageToText } from '@infrastructure/project-manager/storage-to-text';
import { SENSITIVE_TITLE } from '@infrastructure/project-manager/confluence-search';
import { figmaLink } from '@infrastructure/project-manager/figma-design.host';

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const atlassian = (config: ConfigService) => ({
  base: (
    config.get<string>('PM_ATLASSIAN_BASE_URL') ||
    config.get<string>('JIRA_BASE_URL') ||
    ''
  ).replace(/\/$/, ''),
  auth: basicAuth(
    config.get<string>('JIRA_EMAIL') ?? '',
    config.get<string>('JIRA_API_TOKEN') ?? '',
  ),
  hasCreds: Boolean(
    config.get<string>('JIRA_EMAIL') && config.get<string>('JIRA_API_TOKEN'),
  ),
});

// Every ticket in the projects, any status, with description and the latest
// comments
@Injectable()
export class JiraIndexReader implements IIndexReader {
  readonly source = 'jira' as const;
  private readonly a: ReturnType<typeof atlassian>;
  private readonly projects: string[];

  constructor(config: ConfigService) {
    this.a = atlassian(config);
    this.projects = list(config.get<string>('PM_JIRA_PROJECTS')).filter((p) =>
      /^[A-Z][A-Z0-9_]+$/i.test(p),
    );
  }

  isConfigured() {
    return Boolean(this.a.base && this.a.hasCreds && this.projects.length);
  }

  async page(cursor: string | null) {
    const { data } = await getJson<any>(
      `${this.a.base}/rest/api/3/search/jql`,
      { Authorization: this.a.auth },
      {
        method: 'POST',
        body: {
          jql: `project in (${this.projects.join(', ')}) ORDER BY updated DESC`,
          fields: [
            'summary',
            'description',
            'status',
            'assignee',
            'reporter',
            'issuetype',
            'priority',
            'fixVersions',
            'updated',
            'created',
            'comment',
            'parent',
          ],
          maxResults: 50,
          ...(cursor ? { nextPageToken: cursor } : {}),
        },
      },
    );
    const docs: IndexDoc[] = (data.issues ?? []).map((i: any) => {
      const f = i.fields ?? {};
      const comments = (f.comment?.comments ?? [])
        .slice(-10)
        .map(
          (c: any) =>
            `${c.author?.displayName ?? '?'} (${String(c.created ?? '').slice(
              0,
              10,
            )}): ${adfToText(c.body, 500)}`,
        );
      return {
        source: 'jira' as const,
        key: i.key,
        title: `${i.key} ${oneLine(f.summary, 200)}`,
        url: `${this.a.base}/browse/${i.key}`,
        meta: [
          f.issuetype?.name,
          f.status?.name,
          `assignee ${f.assignee?.displayName ?? 'none'}`,
          `by ${f.reporter?.displayName ?? '?'}`,
          f.priority?.name,
          (f.fixVersions ?? []).length
            ? `fix ${(f.fixVersions ?? []).map((v: any) => v.name).join(',')}`
            : '',
          f.parent?.key ? `parent ${f.parent.key}` : '',
          `created ${String(f.created ?? '').slice(0, 10)}`,
        ]
          .filter(Boolean)
          .join(' · '),
        text: redactSecrets(
          `${adfToText(f.description, 4000)}${
            comments.length ? `\n\nComments:\n${comments.join('\n')}` : ''
          }`,
        ),
        updatedAt: f.updated ? new Date(f.updated) : null,
      };
    });
    return {
      docs,
      next: data.isLast === false ? data.nextPageToken ?? null : null,
    };
  }
}

// Every page in the allowed spaces; access/credential pages and anything
// under them or under an excluded page are skipped
@Injectable()
export class ConfluenceIndexReader implements IIndexReader {
  readonly source = 'confluence' as const;
  private readonly a: ReturnType<typeof atlassian>;
  private readonly spaces: string[];
  private readonly excluded: Set<string>;
  private spaceIds: string[] | null = null;
  // id → title and parent, to judge ancestors without refetching
  private readonly pages = new Map<
    string,
    { title: string; parentId: string | null }
  >();

  constructor(config: ConfigService) {
    this.a = atlassian(config);
    this.spaces = list(config.get<string>('PM_CONFLUENCE_SPACES')).filter((k) =>
      /^[A-Za-z0-9~_-]{1,64}$/.test(k),
    );
    this.excluded = new Set(
      list(config.get<string>('PM_CONFLUENCE_EXCLUDE_PAGE_IDS')),
    );
  }

  isConfigured() {
    return Boolean(this.a.base && this.a.hasCreds && this.spaces.length);
  }

  private get headers() {
    return { Authorization: this.a.auth };
  }

  private async ids(): Promise<string[]> {
    if (!this.spaceIds) {
      const { data } = await getJson<any>(
        `${this.a.base}/wiki/api/v2/spaces?keys=${this.spaces
          .map(encodeURIComponent)
          .join(',')}&limit=${this.spaces.length}`,
        this.headers,
      );
      this.spaceIds = (data.results ?? []).map((s: any) => String(s.id));
    }
    return this.spaceIds ?? [];
  }

  private async hidden(id: string, depth = 0): Promise<boolean> {
    if (this.excluded.has(id)) return true;
    let page = this.pages.get(id);
    if (!page) {
      try {
        const { data } = await getJson<any>(
          `${this.a.base}/wiki/api/v2/pages/${id}`,
          this.headers,
        );
        page = {
          title: data.title ?? '',
          parentId: data.parentId ? String(data.parentId) : null,
        };
        this.pages.set(id, page);
      } catch {
        return false;
      }
    }
    if (SENSITIVE_TITLE.test(page.title)) return true;
    return page.parentId && depth < 10
      ? this.hidden(page.parentId, depth + 1)
      : false;
  }

  // cursor = "<space index>|<v2 cursor>"
  async page(cursor: string | null) {
    const ids = await this.ids();
    const [idxRaw, after] = (cursor ?? '0|').split('|');
    const idx = Number(idxRaw) || 0;
    if (idx >= ids.length) return { docs: [], next: null };
    const { data } = await getJson<any>(
      `${this.a.base}/wiki/api/v2/spaces/${
        ids[idx]
      }/pages?body-format=storage&limit=25${
        after ? `&cursor=${encodeURIComponent(after)}` : ''
      }`,
      this.headers,
    );
    const results: any[] = data.results ?? [];
    for (const p of results) {
      this.pages.set(String(p.id), {
        title: p.title ?? '',
        parentId: p.parentId ? String(p.parentId) : null,
      });
    }
    const docs: IndexDoc[] = [];
    for (const p of results) {
      if (await this.hidden(String(p.id))) continue;
      docs.push({
        source: 'confluence',
        key: String(p.id),
        title: oneLine(p.title, 200),
        url: p._links?.webui ? `${this.a.base}/wiki${p._links.webui}` : null,
        meta: `page v${p.version?.number ?? '?'} · edited ${String(
          p.version?.createdAt ?? '',
        ).slice(0, 10)}`,
        text: redactSecrets(
          storageToText(p.body?.storage?.value ?? '', 20_000),
        ),
        updatedAt: p.version?.createdAt ? new Date(p.version.createdAt) : null,
      });
    }
    const nextLink: string | undefined = data._links?.next;
    const nextCursor = nextLink
      ? new URL(nextLink, this.a.base).searchParams.get('cursor')
      : null;
    const next = nextCursor
      ? `${idx}|${nextCursor}`
      : idx + 1 < ids.length
      ? `${idx + 1}|`
      : null;
    return { docs, next };
  }
}

// Frames of each design file (page / frame names) and all comments
@Injectable()
export class FigmaIndexReader implements IIndexReader {
  readonly source = 'figma' as const;
  private readonly token: string;
  private readonly keys: string[];

  constructor(config: ConfigService) {
    this.token = config.get<string>('PM_FIGMA_TOKEN') ?? '';
    this.keys = list(config.get<string>('PM_FIGMA_FILE_KEYS')).filter((k) =>
      /^[A-Za-z0-9]{10,64}$/.test(k),
    );
  }

  isConfigured() {
    return Boolean(this.token && this.keys.length);
  }

  // cursor = file index
  async page(cursor: string | null) {
    const idx = Number(cursor ?? '0') || 0;
    const key = this.keys[idx];
    if (!key) return { docs: [], next: null };
    const headers = { 'X-Figma-Token': this.token };
    const [file, comments] = await Promise.all([
      getJson<any>(`https://api.figma.com/v1/files/${key}?depth=2`, headers, {
        timeoutMs: 60_000,
      }),
      getJson<any>(
        `https://api.figma.com/v1/files/${key}/comments`,
        headers,
      ).catch(() => ({ data: { comments: [] } })),
    ]);
    const docs: IndexDoc[] = [];
    const fileName = file.data.name ?? key;
    for (const page of file.data.document?.children ?? []) {
      for (const frame of page.children ?? []) {
        if (
          !['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(
            frame.type,
          )
        )
          continue;
        docs.push({
          source: 'figma',
          key: `${key}:${frame.id}`,
          title: `${page.name} / ${frame.name}`,
          url: figmaLink(key, frame.id),
          meta: `${fileName} · ${frame.type.toLowerCase()} · node ${frame.id}`,
          text: `${fileName} ${page.name} ${frame.name}`,
          updatedAt: file.data.lastModified
            ? new Date(file.data.lastModified)
            : null,
        });
      }
    }
    for (const c of comments.data.comments ?? []) {
      const nodeId = c.client_meta?.node_id;
      docs.push({
        source: 'figma',
        key: `${key}#${c.id}`,
        title: `Comment by ${c.user?.handle ?? '?'} in ${fileName}`,
        url: nodeId ? figmaLink(key, nodeId) : null,
        meta: `comment · ${c.user?.handle ?? '?'} · ${String(
          c.created_at ?? '',
        ).slice(0, 10)}${c.resolved_at ? ' · resolved' : ''}`,
        text: redactSecrets(oneLine(c.message, 2000)),
        updatedAt: c.created_at ? new Date(c.created_at) : null,
      });
    }
    return { docs, next: idx + 1 < this.keys.length ? String(idx + 1) : null };
  }
}

const PR_PAGES = 3;

// Pull requests of each repo (open and closed, newest 300), with bodies
@Injectable()
export class GitHubIndexReader implements IIndexReader {
  readonly source = 'github' as const;
  private readonly token: string;
  private readonly org: string;
  private readonly repos: string[];

  constructor(config: ConfigService) {
    this.token = config.get<string>('PM_GITHUB_TOKEN') ?? '';
    this.org = config.get<string>('PM_GITHUB_ORG') ?? '';
    this.repos = list(config.get<string>('PM_GITHUB_REPOS')).filter((r) =>
      /^[\w.-]+$/.test(r),
    );
  }

  isConfigured() {
    return Boolean(this.token && this.org && this.repos.length);
  }

  // cursor = "<repo index>|<page>"
  async page(cursor: string | null) {
    const [r, p] = (cursor ?? '0|1').split('|').map(Number);
    const repo = this.repos[r];
    if (!repo) return { docs: [], next: null };
    const { data } = await getJson<any[]>(
      `https://api.github.com/repos/${this.org}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${p}`,
      {
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    );
    const docs: IndexDoc[] = (data ?? []).map((pr: any) => ({
      source: 'github' as const,
      key: `${repo}#${pr.number}`,
      title: `${repo}#${pr.number} ${oneLine(pr.title, 200)}`,
      url: pr.html_url ?? null,
      meta: [
        pr.merged_at ? `merged ${String(pr.merged_at).slice(0, 10)}` : pr.state,
        `by ${pr.user?.login ?? '?'}`,
        `${pr.head?.ref ?? '?'} → ${pr.base?.ref ?? '?'}`,
      ].join(' · '),
      text: redactSecrets(oneLine(pr.body, 4000)),
      updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
    }));
    const more = (data ?? []).length === 100 && p < PR_PAGES;
    const next = more
      ? `${r}|${p + 1}`
      : r + 1 < this.repos.length
      ? `${r + 1}|1`
      : null;
    return { docs, next };
  }
}
