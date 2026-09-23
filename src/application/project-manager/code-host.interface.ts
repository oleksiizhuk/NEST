export const CODE_HOST = 'CODE_HOST';

export interface CodeSearchHit {
  path: string;
  fragments: string[];
}

// Read-only access to the team's repositories. Repo names are checked
// against an allowlist by the implementation.
export interface ICodeHost {
  isConfigured(): boolean;
  repos(): string[];
  searchCode(repo: string, query: string): Promise<CodeSearchHit[]>;
  readFile(
    repo: string,
    path: string,
    ref?: string,
    fromLine?: number,
    toLine?: number,
  ): Promise<string>;
  listDir(repo: string, path: string, ref?: string): Promise<string[]>;
  pullRequest(repo: string, num: number): Promise<string>;
}
