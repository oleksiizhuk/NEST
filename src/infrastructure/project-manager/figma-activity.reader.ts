import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IProjectSource } from '@application/project-manager/project-source.interface';
import {
  getJson,
  oneLine,
  shortDate,
} from '@infrastructure/project-manager/http-json';

const API = 'https://api.figma.com/v1';
const FRAMES_PER_PAGE = 40;
const RECENT_DAYS = 14;

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
}

interface FigmaFile {
  name: string;
  lastModified: string;
  document: FigmaNode;
}

interface FigmaVersion {
  id: string;
  created_at: string;
  label: string | null;
  description: string | null;
  user?: { handle?: string };
}

interface FigmaComment {
  id: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
  parent_id?: string;
  user?: { handle?: string };
  client_meta?: { node_id?: string } | null;
}

// Design as the team sees it: the file's pages and top-level frames, what
// changed recently (named versions and autosaves) and open comments.
@Injectable()
export class FigmaActivityReader implements IProjectSource {
  readonly source = 'design' as const;
  private readonly token: string;
  private readonly fileKeys: string[];

  constructor(config: ConfigService) {
    this.token = config.get<string>('PM_FIGMA_TOKEN') ?? '';
    this.fileKeys = (config.get<string>('PM_FIGMA_FILE_KEYS') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => /^[A-Za-z0-9]{10,}$/.test(k));
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.fileKeys.length);
  }

  async fetch(now = new Date()): Promise<string> {
    const parts = await Promise.all(
      this.fileKeys.map((key) =>
        this.file(key, now).catch(
          (error) =>
            `## Figma file ${key}: could not read (${
              (error as Error).message
            })`,
        ),
      ),
    );
    return parts.join('\n\n');
  }

  private get headers(): Record<string, string> {
    return { 'X-Figma-Token': this.token };
  }

  private async file(key: string, now: Date): Promise<string> {
    const since = new Date(
      now.getTime() - RECENT_DAYS * 86_400_000,
    ).toISOString();
    const [file, versions, comments] = await Promise.all([
      getJson<FigmaFile>(`${API}/files/${key}?depth=2`, this.headers, {
        timeoutMs: 40_000,
      }),
      getJson<{ versions: FigmaVersion[] }>(
        `${API}/files/${key}/versions?page_size=50`,
        this.headers,
      ),
      getJson<{ comments: FigmaComment[] }>(
        `${API}/files/${key}/comments`,
        this.headers,
      ),
    ]);

    const pages = (file.data.document.children ?? []).map((page) => {
      const frames = (page.children ?? []).filter((n) =>
        ['FRAME', 'SECTION', 'COMPONENT_SET', 'COMPONENT'].includes(n.type),
      );
      const names = frames
        .slice(0, FRAMES_PER_PAGE)
        .map((n) => `${oneLine(n.name, 60)} [${n.id}]`)
        .join('; ');
      const more =
        frames.length > FRAMES_PER_PAGE
          ? ` … +${frames.length - FRAMES_PER_PAGE} more`
          : '';
      return `- ${page.name} [${page.id}] (${frames.length} top-level): ${names}${more}`;
    });

    const recentVersions = (versions.data.versions ?? []).filter(
      (v) => v.created_at >= since,
    );
    const named = recentVersions.filter((v) => v.label || v.description);
    const autosavesByDay = new Map<string, Set<string>>();
    for (const v of recentVersions) {
      const day = v.created_at.slice(0, 10);
      const set = autosavesByDay.get(day) ?? new Set<string>();
      set.add(v.user?.handle ?? '?');
      autosavesByDay.set(day, set);
    }

    const topLevel = (comments.data.comments ?? []).filter((c) => !c.parent_id);
    const open = topLevel.filter((c) => !c.resolved_at);
    const recent = topLevel.filter((c) => c.created_at >= since);
    const shown = [
      ...new Map([...open, ...recent].map((c) => [c.id, c])).values(),
    ]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 40);

    return [
      `## Figma: ${
        file.data.name
      } (file ${key}, last modified ${file.data.lastModified
        .slice(0, 16)
        .replace('T', ' ')})`,
      'Pages and top-level frames:',
      ...pages,
      `Named versions in the last ${RECENT_DAYS} days (${named.length}):`,
      ...(named.length
        ? named.map(
            (v) =>
              `  ${shortDate(v.created_at)} ${v.user?.handle ?? '?'}: ${oneLine(
                v.label,
                80,
              )}${v.description ? ` — ${oneLine(v.description, 160)}` : ''}`,
          )
        : ['  none']),
      `Edit activity by day: ${
        [...autosavesByDay.entries()]
          .map(([day, who]) => `${day.slice(5)} ${[...who].join('/')}`)
          .join('; ') || 'none'
      }`,
      `Comments: ${open.length} unresolved; showing unresolved and last ${RECENT_DAYS} days (${shown.length}):`,
      ...(shown.length
        ? shown.map(
            (c) =>
              `  ${shortDate(c.created_at)} ${c.user?.handle ?? '?'}${
                c.resolved_at ? ' (resolved)' : ''
              }${
                c.client_meta?.node_id ? ` on ${c.client_meta.node_id}` : ''
              }: ${oneLine(c.message, 200)}`,
          )
        : ['  none']),
    ].join('\n');
  }
}
