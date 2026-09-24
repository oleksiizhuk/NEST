// A local, searchable copy of the project: every ticket with its
// description and comments, doc pages, design frames and comments, PRs.
// Built by calling the source APIs only — no model tokens — and read by the
// bot a few fragments at a time.
export const PM_INDEX = 'PM_INDEX';
export const PM_INDEX_JOB = 'PM_INDEX_JOB';
export const PM_INDEX_READERS = 'PM_INDEX_READERS';

export type IndexSource = 'jira' | 'confluence' | 'figma' | 'github';
export const INDEX_SOURCES: IndexSource[] = [
  'jira',
  'confluence',
  'figma',
  'github',
];

export interface IndexDoc {
  source: IndexSource;
  key: string;
  title: string;
  url: string | null;
  // One line of facts: status, assignee, author, dates
  meta: string;
  text: string;
  updatedAt: Date | null;
}

export interface IndexHit {
  source: IndexSource;
  key: string;
  title: string;
  url: string | null;
  meta: string;
  snippet: string;
  updatedAt: Date | null;
}

export interface IProjectIndex {
  upsert(docs: IndexDoc[], runId: string): Promise<void>;
  search(
    query: string,
    limit: number,
    source?: IndexSource,
  ): Promise<IndexHit[]>;
  get(source: IndexSource, key: string): Promise<IndexDoc | null>;
  counts(): Promise<Partial<Record<IndexSource, number>>>;
  // Drops what the finished run no longer saw (deleted tickets, pages)
  removeStale(source: IndexSource, runId: string): Promise<number>;
}

export interface IndexJobState {
  runId: string;
  status: 'running' | 'done' | 'failed';
  stage: IndexSource | 'done';
  cursor: string | null;
  counts: Partial<Record<IndexSource, number>>;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

export interface IIndexJob {
  get(): Promise<IndexJobState | null>;
  save(state: IndexJobState): Promise<void>;
}

// One source, read a page at a time so a run can stop and continue
export interface IIndexReader {
  source: IndexSource;
  isConfigured(): boolean;
  page(
    cursor: string | null,
  ): Promise<{ docs: IndexDoc[]; next: string | null }>;
}
