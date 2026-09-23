import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IProjectSource } from '@application/project-manager/project-source.interface';
import { basicAuth, getJson } from '@infrastructure/project-manager/http-json';
import { storageToText } from '@infrastructure/project-manager/storage-to-text';

const MAX_CHARS_PER_PAGE = 25_000;

interface ConfluencePage {
  id: string;
  title: string;
  version?: { number?: number; createdAt?: string };
  body?: { storage?: { value?: string } };
}

@Injectable()
export class ConfluencePageReader implements IProjectSource {
  readonly source = 'docs' as const;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly pageIds: string[];

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

  // One page failing (deleted, no permission) does not drop the others.
  async fetch(): Promise<string> {
    const pages = await Promise.all(
      this.pageIds.map((id) =>
        this.page(id).catch(
          (error) =>
            `## page ${id}: could not read (${(error as Error).message})`,
        ),
      ),
    );
    return pages.join('\n\n');
  }

  private async page(id: string): Promise<string> {
    const { data } = await getJson<ConfluencePage>(
      `${this.baseUrl}/wiki/api/v2/pages/${id}?body-format=storage`,
      { Authorization: this.auth },
    );
    const version = data.version?.number ?? '?';
    const edited = data.version?.createdAt?.slice(0, 10) ?? '?';
    return (
      `## ${data.title} (page ${data.id}, v${version}, edited ${edited})\n` +
      storageToText(data.body?.storage?.value ?? '', MAX_CHARS_PER_PAGE)
    );
  }
}
