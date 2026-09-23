/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IDocComments,
  Remark,
} from '@application/project-manager/collaboration.interface';
import { basicAuth, getJson } from '@infrastructure/project-manager/http-json';
import { storageToText } from '@infrastructure/project-manager/storage-to-text';

const CONCURRENCY = 8;

// Footer and open inline comments (with replies) on the configured pages.
@Injectable()
export class ConfluenceCommentsReader implements IDocComments {
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly pageIds: string[];
  private readonly names = new Map<string, string>();

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
    this.pageIds = (config.get<string>('PM_CONFLUENCE_PAGE_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => /^\d+$/.test(id));
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.pageIds.length);
  }

  private get headers() {
    return { Authorization: this.auth };
  }

  private async author(accountId?: string): Promise<string> {
    if (!accountId) return '?';
    if (this.names.has(accountId)) return this.names.get(accountId) as string;
    try {
      const { data } = await getJson<any>(
        `${this.baseUrl}/wiki/rest/api/user?accountId=${encodeURIComponent(
          accountId,
        )}`,
        this.headers,
      );
      this.names.set(
        accountId,
        data.displayName ?? data.publicName ?? accountId,
      );
    } catch {
      this.names.set(accountId, accountId);
    }
    return this.names.get(accountId) as string;
  }

  // The original author and time: version 1 of an edited comment
  private async original(
    kind: string,
    c: any,
  ): Promise<{ authorId?: string; createdAt: Date }> {
    const latest = {
      authorId: c.version?.authorId,
      createdAt: new Date(c.version?.createdAt ?? 0),
    };
    if (!c.version?.number || c.version.number <= 1) return latest;
    try {
      const { data } = await getJson<any>(
        `${this.baseUrl}/wiki/api/v2/${kind}-comments/${c.id}/versions/1`,
        this.headers,
      );
      return {
        authorId: data.authorId ?? latest.authorId,
        createdAt: new Date(data.createdAt ?? latest.createdAt),
      };
    } catch {
      return latest;
    }
  }

  private async toRemark(
    page: any,
    kind: string,
    c: any,
    since: number,
  ): Promise<Remark | null> {
    const first = await this.original(kind, c);
    // Questions asked before the window are out of scope; skip before
    // spending requests on their replies
    if (first.createdAt.getTime() < since) return null;
    const { data: children } = await getJson<any>(
      `${this.baseUrl}/wiki/api/v2/${kind}-comments/${c.id}/children?limit=50`,
      this.headers,
    ).catch(() => ({ data: { results: [] as any[] } }));
    const replies = await Promise.all(
      (children.results ?? []).map(async (r: any) => ({
        author: await this.author(r.version?.authorId),
        createdAt: new Date(r.version?.createdAt ?? 0),
      })),
    );
    const anchor = c.properties?.inlineOriginalSelection;
    return {
      source: 'confluence',
      where: `${page.title}${
        anchor ? ` — on «${String(anchor).slice(0, 80)}»` : ''
      }`,
      link: page._links?.webui
        ? `${this.baseUrl}/wiki${page._links.webui}`
        : null,
      author: await this.author(first.authorId),
      createdAt: first.createdAt,
      text: storageToText(c.body?.storage?.value ?? '', 400).replace(
        /\n/g,
        ' ',
      ),
      replies: replies.sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      ),
      resolved: c.resolutionStatus === 'resolved',
    };
  }

  async recentComments(days: number): Promise<Remark[]> {
    const since = Date.now() - days * 86_400_000;
    const pages = await Promise.all(
      this.pageIds.map(async (pageId) => {
        const [{ data: page }, footer, inline] = await Promise.all([
          getJson<any>(
            `${this.baseUrl}/wiki/api/v2/pages/${pageId}`,
            this.headers,
          ),
          getJson<any>(
            `${this.baseUrl}/wiki/api/v2/pages/${pageId}/footer-comments?body-format=storage&limit=100`,
            this.headers,
          ),
          getJson<any>(
            `${this.baseUrl}/wiki/api/v2/pages/${pageId}/inline-comments?body-format=storage&resolution-status=open&limit=100`,
            this.headers,
          ),
        ]);
        return [
          ...(footer.data.results ?? []).map((c: any) => ({
            page,
            kind: 'footer',
            c,
          })),
          ...(inline.data.results ?? []).map((c: any) => ({
            page,
            kind: 'inline',
            c,
          })),
        ];
      }),
    );
    const jobs = pages.flat();
    // A few requests at a time: quick enough, polite to the API
    const out: Array<Remark | null> = new Array(jobs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const i = next++;
        const { page, kind, c } = jobs[i];
        out[i] = await this.toRemark(page, kind, c, since).catch(() => null);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker),
    );
    return out.filter((r): r is Remark => r !== null);
  }
}
