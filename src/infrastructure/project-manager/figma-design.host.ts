/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IDesignHost,
  Remark,
} from '@application/project-manager/collaboration.interface';
import { getJson } from '@infrastructure/project-manager/http-json';

const API = 'https://api.figma.com/v1';
const MAX_LINES = 400;
const MAX_CHARS = 30_000;
const NODE_ID = /^\d+[:-]\d+$/;

const hex = (c: any): string => {
  const to = (v: number) =>
    Math.round((v ?? 0) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
};

export const figmaLink = (fileKey: string, id: string): string =>
  `https://www.figma.com/design/${fileKey}?node-id=${id.replace(':', '-')}`;

// Compact, one line per node: what a designer or developer needs to compare
// a frame with the app — sizes, colours, text, spacing, components.
export const renderNode = (
  node: any,
  components: Record<string, any>,
  depth = 0,
  lines: string[] = [],
): string[] => {
  if (!node || lines.length >= MAX_LINES || node.visible === false)
    return lines;
  const bits: string[] = [
    `${'  '.repeat(depth)}${node.type} "${node.name}" [${node.id}]`,
  ];
  const box = node.absoluteBoundingBox;
  if (box) bits.push(`${Math.round(box.width)}×${Math.round(box.height)}`);
  const fills = (node.fills ?? []).filter(
    (f: any) => f.visible !== false && f.type === 'SOLID',
  );
  if (fills.length)
    bits.push(
      `fill ${fills
        .map(
          (f: any) =>
            hex(f.color) +
            (f.opacity !== undefined && f.opacity < 1
              ? `@${f.opacity.toFixed(2)}`
              : ''),
        )
        .join(',')}`,
    );
  const strokes = (node.strokes ?? []).filter((s: any) => s.type === 'SOLID');
  if (strokes.length)
    bits.push(
      `stroke ${strokes.map((s: any) => hex(s.color)).join(',')} ${
        node.strokeWeight ?? ''
      }`.trim(),
    );
  if (node.cornerRadius) bits.push(`radius ${node.cornerRadius}`);
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    bits.push(
      `auto-layout ${node.layoutMode.toLowerCase()} gap ${
        node.itemSpacing ?? 0
      } pad ${node.paddingTop ?? 0}/${node.paddingRight ?? 0}/${
        node.paddingBottom ?? 0
      }/${node.paddingLeft ?? 0}`,
    );
  }
  if (node.type === 'TEXT') {
    const st = node.style ?? {};
    bits.push(
      `"${String(node.characters ?? '')
        .slice(0, 200)
        .replace(/\n/g, ' ')}"`,
    );
    bits.push(
      `${st.fontFamily ?? '?'} ${st.fontWeight ?? ''} ${st.fontSize ?? ''}px${
        st.lineHeightPx ? ` lh ${Math.round(st.lineHeightPx)}` : ''
      }`,
    );
  }
  if (node.type === 'INSTANCE' && node.componentId) {
    bits.push(
      `instance of ${components[node.componentId]?.name ?? node.componentId}`,
    );
  }
  lines.push(bits.join(' · '));
  for (const child of node.children ?? [])
    renderNode(child, components, depth + 1, lines);
  return lines;
};

@Injectable()
export class FigmaDesignHost implements IDesignHost {
  private readonly token: string;
  private readonly keys: string[];
  private readonly cache = new Map<string, { text: string; until: number }>();

  constructor(config: ConfigService) {
    this.token = config.get<string>('PM_FIGMA_TOKEN') ?? '';
    this.keys = (config.get<string>('PM_FIGMA_FILE_KEYS') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => /^[A-Za-z0-9]{10,}$/.test(k));
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.keys.length);
  }

  fileKeys(): string[] {
    return [...this.keys];
  }

  private get headers() {
    return { 'X-Figma-Token': this.token };
  }

  private key(fileKey: string): string {
    const k = String(fileKey ?? '').trim() || this.keys[0];
    if (!this.keys.includes(k))
      throw new Error(`Unknown design file "${fileKey}"`);
    return k;
  }

  private ids(ids: string[]): string[] {
    const clean = (ids ?? []).map((i) => String(i).trim().replace('-', ':'));
    if (
      !clean.length ||
      clean.length > 5 ||
      clean.some((i) => !NODE_ID.test(i))
    ) {
      throw new Error('ids must be 1–5 node ids like 123:456');
    }
    return clean;
  }

  async getNodes(
    fileKey: string,
    ids: string[],
    depth: number,
  ): Promise<string> {
    const key = this.key(fileKey);
    const nodeIds = this.ids(ids);
    const d = Math.max(1, Math.min(4, Math.floor(depth || 2)));
    const cacheKey = `${key}|${nodeIds.join(',')}|${d}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.until > Date.now()) return hit.text;
    const { data } = await getJson<any>(
      `${API}/files/${key}/nodes?ids=${encodeURIComponent(
        nodeIds.join(','),
      )}&depth=${d}`,
      this.headers,
      { timeoutMs: 40_000 },
    );
    const parts = Object.entries(data.nodes ?? {}).map(
      ([id, entry]: [string, any]) => {
        if (!entry?.document) return `[${id}] not found in the file`;
        const lines = renderNode(entry.document, entry.components ?? {});
        return `Open: ${figmaLink(key, id)}\n${lines.join('\n')}${
          lines.length >= MAX_LINES
            ? '\n… truncated — ask for a child id or a smaller depth'
            : ''
        }`;
      },
    );
    const text = parts.join('\n\n').slice(0, MAX_CHARS);
    this.cache.set(cacheKey, { text, until: Date.now() + 10 * 60_000 });
    return text;
  }

  async imageLink(fileKey: string, id: string): Promise<string> {
    const key = this.key(fileKey);
    const [nodeId] = this.ids([id]);
    const { data } = await getJson<any>(
      `${API}/images/${key}?ids=${encodeURIComponent(
        nodeId,
      )}&format=png&scale=1`,
      this.headers,
      { timeoutMs: 40_000 },
    );
    const url = data.images?.[nodeId];
    if (!url)
      throw new Error(data.err || 'Figma returned no image for this node');
    return `PNG (temporary link): ${url}\nOpen in Figma: ${figmaLink(
      key,
      nodeId,
    )}`;
  }

  async recentComments(days: number): Promise<Remark[]> {
    const since = Date.now() - days * 86_400_000;
    const out: Remark[] = [];
    for (const key of this.keys) {
      const { data } = await getJson<any>(
        `${API}/files/${key}/comments`,
        this.headers,
      );
      const all: any[] = data.comments ?? [];
      const byParent = new Map<string, any[]>();
      for (const c of all) {
        if (c.parent_id)
          byParent.set(c.parent_id, [...(byParent.get(c.parent_id) ?? []), c]);
      }
      for (const c of all.filter((x) => !x.parent_id)) {
        const replies = (byParent.get(c.id) ?? [])
          .map((r) => ({
            author: r.user?.handle ?? '?',
            createdAt: new Date(r.created_at),
          }))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const latest = replies.reduce(
          (t, r) => Math.max(t, r.createdAt.getTime()),
          new Date(c.created_at).getTime(),
        );
        if (latest < since && c.resolved_at) continue;
        if (latest < since) continue;
        const nodeId = c.client_meta?.node_id;
        out.push({
          source: 'figma',
          where: nodeId ? `node ${nodeId}` : 'file',
          link: nodeId
            ? figmaLink(key, nodeId)
            : `https://www.figma.com/design/${key}`,
          author: c.user?.handle ?? '?',
          createdAt: new Date(c.created_at),
          text: String(c.message ?? '')
            .slice(0, 400)
            .replace(/\n/g, ' '),
          replies,
          resolved: Boolean(c.resolved_at),
        });
      }
    }
    return out;
  }
}
