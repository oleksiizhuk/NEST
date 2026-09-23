// Read-only access to where the team talks: ticket details and comments,
// doc comments, design comments and nodes. Everything returned is text for
// the model and is treated as untrusted data.
export const ISSUE_DETAILS = 'ISSUE_DETAILS';
export const DOC_COMMENTS = 'DOC_COMMENTS';
export const DESIGN_HOST = 'DESIGN_HOST';
export const DOC_SEARCH = 'DOC_SEARCH';

export interface Remark {
  source: 'jira' | 'confluence' | 'figma';
  // Issue key, page title or frame/node reference
  where: string;
  link: string | null;
  author: string;
  createdAt: Date;
  text: string;
  // Replies after this remark, oldest first
  replies: Array<{ author: string; createdAt: Date }>;
  resolved: boolean;
}

export interface IIssueDetails {
  isConfigured(): boolean;
  // One issue: fields, description, recent comments and transitions
  getIssue(key: string): Promise<string>;
  // Comments on issues updated in the last `days`
  recentComments(days: number): Promise<Remark[]>;
}

export interface IDocComments {
  isConfigured(): boolean;
  recentComments(days: number): Promise<Remark[]>;
}

export interface IDesignHost {
  isConfigured(): boolean;
  fileKeys(): string[];
  getNodes(fileKey: string, ids: string[], depth: number): Promise<string>;
  imageLink(fileKey: string, id: string): Promise<string>;
  recentComments(days: number): Promise<Remark[]>;
}

// Docs beyond the pages in the snapshot, limited to allowed spaces. Pages
// that look like they hold credentials are never returned.
export interface IDocSearch {
  isConfigured(): boolean;
  search(query: string): Promise<string>;
  readPage(id: string): Promise<string>;
}
