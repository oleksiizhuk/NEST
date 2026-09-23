import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CodeSearchHit,
  ICodeHost,
} from '@application/project-manager/code-host.interface';
import { getJson } from '@infrastructure/project-manager/http-json';

const API = 'https://api.github.com';
const MAX_FILE_CHARS = 20_000;
const MAX_LINES = 400;

@Injectable()
export class GitHubCodeHost implements ICodeHost {
  private readonly token: string;
  private readonly org: string;
  private readonly allowed: string[];

  constructor(config: ConfigService) {
    this.token = config.get<string>('PM_GITHUB_TOKEN') ?? '';
    this.org = config.get<string>('PM_GITHUB_ORG') ?? '';
    this.allowed = (
      config.get<string>('PM_CODE_REPOS') ||
      config.get<string>('PM_GITHUB_REPOS') ||
      ''
    )
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.org && this.allowed.length);
  }

  repos(): string[] {
    return [...this.allowed];
  }

  private repo(name: string): string {
    const repo = String(name ?? '').trim();
    if (!this.allowed.includes(repo)) {
      throw new Error(
        `Unknown repo "${repo}". Allowed: ${this.allowed.join(', ')}`,
      );
    }
    return repo;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async searchCode(repo: string, query: string): Promise<CodeSearchHit[]> {
    const q = `${String(query).slice(0, 200)} repo:${this.org}/${this.repo(
      repo,
    )}`;
    const { data } = await getJson<{
      items: Array<{
        path: string;
        text_matches?: Array<{ fragment?: string }>;
      }>;
    }>(`${API}/search/code?per_page=15&q=${encodeURIComponent(q)}`, {
      ...this.headers,
      Accept: 'application/vnd.github.text-match+json',
    });
    return (data.items ?? []).map((item) => ({
      path: item.path,
      fragments: (item.text_matches ?? [])
        .map((m) => (m.fragment ?? '').slice(0, 300))
        .filter(Boolean)
        .slice(0, 2),
    }));
  }

  async readFile(
    repo: string,
    path: string,
    ref?: string,
    fromLine?: number,
    toLine?: number,
  ): Promise<string> {
    const url =
      `${API}/repos/${this.org}/${this.repo(repo)}/contents/` +
      encodeURI(String(path).replace(/^\/+/, '')) +
      (ref ? `?ref=${encodeURIComponent(ref)}` : '');
    const { data } = await getJson<{
      type?: string;
      content?: string;
      encoding?: string;
      size?: number;
    }>(url, this.headers);
    if (data.type !== 'file' || data.encoding !== 'base64') {
      throw new Error(`${path} is not a readable file (try list_dir)`);
    }
    const lines = Buffer.from(data.content ?? '', 'base64')
      .toString('utf8')
      .split('\n');
    const start = Math.max(1, Math.floor(fromLine ?? 1));
    const end = Math.min(
      lines.length,
      Math.floor(toLine ?? start + MAX_LINES - 1),
      start + MAX_LINES - 1,
    );
    const body = lines
      .slice(start - 1, end)
      .map((line, i) => `${start + i}: ${line}`)
      .join('\n')
      .slice(0, MAX_FILE_CHARS);
    return `${path} lines ${start}-${end} of ${lines.length}\n${body}`;
  }

  async listDir(repo: string, path: string, ref?: string): Promise<string[]> {
    const url =
      `${API}/repos/${this.org}/${this.repo(repo)}/contents/` +
      encodeURI(String(path ?? '').replace(/^\/+/, '')) +
      (ref ? `?ref=${encodeURIComponent(ref)}` : '');
    const { data } = await getJson<Array<{ name: string; type: string }>>(
      url,
      this.headers,
    );
    if (!Array.isArray(data)) throw new Error(`${path} is a file`);
    return data
      .slice(0, 300)
      .map((e) => (e.type === 'dir' ? `${e.name}/` : e.name));
  }

  async pullRequest(repo: string, num: number): Promise<string> {
    const base = `${API}/repos/${this.org}/${this.repo(
      repo,
    )}/pulls/${Math.floor(num)}`;
    const [{ data: pr }, { data: files }] = await Promise.all([
      getJson<{
        title: string;
        state: string;
        merged_at: string | null;
        user?: { login?: string };
        head: { ref: string };
        base: { ref: string };
        body: string | null;
      }>(base, this.headers),
      getJson<
        Array<{ filename: string; additions: number; deletions: number }>
      >(`${base}/files?per_page=100`, this.headers),
    ]);
    return [
      `#${num} ${pr.title}`,
      `${pr.state}${
        pr.merged_at ? ` (merged ${pr.merged_at.slice(0, 10)})` : ''
      } · ${pr.user?.login ?? '?'} · ${pr.head.ref} → ${pr.base.ref}`,
      (pr.body ?? '').slice(0, 3000),
      `Files (${files.length}):`,
      ...files.map((f) => `  ${f.filename} +${f.additions} -${f.deletions}`),
    ].join('\n');
  }
}
