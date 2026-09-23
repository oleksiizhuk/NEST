import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IDocSearch } from '@application/project-manager/collaboration.interface';
import {
  basicAuth,
  getJson,
  oneLine,
} from '@infrastructure/project-manager/http-json';
import { storageToText } from '@infrastructure/project-manager/storage-to-text';

const MAX_RESULTS = 10;
const MAX_CHARS_PER_PAGE = 25_000;
// Pages about access and secrets stay out of the bot's reach whatever their
// space: their text would land in a chat
export const SENSITIVE_TITLE =
  /(credential|password|passwd|secret|\baccess\b|\btokens?\b|api[ _-]?keys?|доступ|парол|секрет)/i;

interface SearchResult {
  content?: { id?: string; title?: string; type?: string };
  excerpt?: string;
  lastModified?: string;
  resultGlobalContainer?: { title?: string };
}

interface Page {
  id: string;
  title: string;
  spaceId?: string;
  version?: { number?: number; createdAt?: string };
  body?: { storage?: { value?: string } };
}

const list = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

@Injectable()
export class ConfluenceSearch implements IDocSearch {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly spaces: string[];
  private readonly snapshotPages: Set<string>;
  private readonly excluded: Set<string>;
  private spaceIds: Promise<Set<string>> | null = null;

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
    this.spaces = list(config.get<string>('PM_CONFLUENCE_SPACES')).filter((k) =>
      /^[A-Za-z0-9~_-]{1,64}$/.test(k),
    );
    this.snapshotPages = new Set(
      list(config.get<string>('PM_CONFLUENCE_PAGE_IDS')),
    );
    this.excluded = new Set(
      list(config.get<string>('PM_CONFLUENCE_EXCLUDE_PAGE_IDS')),
    );
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.spaces.length);
  }

  private get headers() {
    return { Authorization: this.auth };
  }

  private hidden(id: string | undefined, title: string | undefined): boolean {
    return Boolean(
      !id || this.excluded.has(id) || SENSITIVE_TITLE.test(title ?? ''),
    );
  }

  async search(query: string): Promise<string> {
    // CQL string literal: quotes and backslashes would end or escape it
    const term = query.replace(/["\\]/g, ' ').trim().slice(0, 100);
    if (!term) throw new Error('empty query');
    const spaces = this.spaces.map((k) => `"${k}"`).join(',');
    const cql = `type=page AND space in (${spaces}) AND (title ~ "${term}" OR text ~ "${term}") ORDER BY lastmodified DESC`;
    const { data } = await getJson<{ results?: SearchResult[] }>(
      `${this.baseUrl}/wiki/rest/api/search?cql=${encodeURIComponent(
        cql,
      )}&limit=${MAX_RESULTS * 2}`,
      this.headers,
    );
    const rows = (data.results ?? [])
      .filter((r) => !this.hidden(r.content?.id, r.content?.title))
      .slice(0, MAX_RESULTS)
      .map(
        (r) =>
          `${r.content?.id} | ${oneLine(r.content?.title, 120)} | ${
            r.resultGlobalContainer?.title ?? '?'
          } | edited ${(r.lastModified ?? '').slice(0, 10) || '?'} | ${oneLine(
            (r.excerpt ?? '').replace(/@@@(end)?hl@@@/g, ''),
            200,
          )}`,
      );
    return rows.length
      ? `id | title | space | edited | excerpt\n${rows.join('\n')}`
      : 'No pages found in the allowed spaces. Try other words, or a title fragment.';
  }

  async readPage(id: string): Promise<string> {
    if (!/^\d{1,20}$/.test(id)) throw new Error('page id must be digits');
    if (this.excluded.has(id))
      throw new Error('This page is not readable here.');
    const { data } = await getJson<Page>(
      `${this.baseUrl}/wiki/api/v2/pages/${id}?body-format=storage`,
      this.headers,
    );
    if (this.hidden(data.id, data.title)) {
      throw new Error(
        'This page looks like it holds access details; it is not readable here.',
      );
    }
    if (
      !this.snapshotPages.has(id) &&
      !(await this.allowedSpaceIds()).has(String(data.spaceId))
    ) {
      throw new Error('This page is outside the allowed spaces.');
    }
    const children = await getJson<{
      results?: Array<{ id: string; title: string }>;
    }>(
      `${this.baseUrl}/wiki/api/v2/pages/${id}/children?limit=50`,
      this.headers,
    )
      .then(({ data: c }) =>
        (c.results ?? [])
          .filter((p) => !this.hidden(p.id, p.title))
          .map((p) => `${p.id} ${oneLine(p.title, 80)}`),
      )
      .catch(() => [] as string[]);
    return (
      `## ${data.title} (page ${data.id}, v${
        data.version?.number ?? '?'
      }, edited ${data.version?.createdAt?.slice(0, 10) ?? '?'})\n` +
      storageToText(data.body?.storage?.value ?? '', MAX_CHARS_PER_PAGE) +
      (children.length ? `\n\nChild pages: ${children.join('; ')}` : '')
    );
  }

  // Space keys → ids once per instance; a failed lookup is retried next time
  private allowedSpaceIds(): Promise<Set<string>> {
    if (!this.spaceIds) {
      this.spaceIds = getJson<{ results?: Array<{ id: string | number }> }>(
        `${this.baseUrl}/wiki/api/v2/spaces?keys=${this.spaces
          .map(encodeURIComponent)
          .join(',')}&limit=${this.spaces.length}`,
        this.headers,
      )
        .then(
          ({ data }) => new Set((data.results ?? []).map((s) => String(s.id))),
        )
        .catch((error) => {
          this.spaceIds = null;
          throw error;
        });
    }
    return this.spaceIds;
  }
}
