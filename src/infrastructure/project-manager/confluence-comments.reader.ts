/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IDocComments,
  Remark,
} from '@application/project-manager/collaboration.interface';
import { basicAuth, getJson } from '@infrastructure/project-manager/http-json';
import { storageToText } from '@infrastructure/project-manager/storage-to-text';

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

  async recentComments(days: number): Promise<Remark[]> {
    const since = Date.now() - days * 86_400_000;
    const out: Remark[] = [];
    for (const pageId of this.pageIds) {
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
      const kinds: Array<[string, any[]]> = [
        ['footer', footer.data.results ?? []],
        ['inline', inline.data.results ?? []],
      ];
      for (const [kind, comments] of kinds) {
        for (const c of comments) {
          const created = new Date(c.version?.createdAt ?? c.createdAt ?? 0);
          const { data: children } = await getJson<any>(
            `${this.baseUrl}/wiki/api/v2/${kind}-comments/${c.id}/children?limit=50`,
            this.headers,
          ).catch(() => ({ data: { results: [] } }));
          const replies = await Promise.all(
            (children.results ?? []).map(async (r: any) => ({
              author: await this.author(r.version?.authorId),
              createdAt: new Date(r.version?.createdAt ?? 0),
            })),
          );
          const latest = replies.reduce(
            (t, r) => Math.max(t, r.createdAt.getTime()),
            created.getTime(),
          );
          if (latest < since) continue;
          const anchor = c.properties?.inlineOriginalSelection;
          out.push({
            source: 'confluence',
            where: `${page.title}${
              anchor ? ` — on «${String(anchor).slice(0, 80)}»` : ''
            }`,
            link: page._links?.webui
              ? `${this.baseUrl}/wiki${page._links.webui}`
              : null,
            author: await this.author(c.version?.authorId),
            createdAt: created,
            text: storageToText(c.body?.storage?.value ?? '', 400).replace(
              /\n/g,
              ' ',
            ),
            replies,
            resolved: c.resolutionStatus === 'resolved',
          });
        }
      }
    }
    return out;
  }
}
