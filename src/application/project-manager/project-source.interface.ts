import { SnapshotSource } from '@domain/project-status/project-snapshot.entity';

export const PROJECT_SOURCES = 'PROJECT_SOURCES';

// A read-only view of one system (issue tracker, docs, code host). No write
// methods exist on purpose: the PM mode can look, never change.
export interface IProjectSource {
  readonly source: SnapshotSource;
  // False when credentials are missing; the section is then skipped
  isConfigured(): boolean;
  // Compact text for the model, optionally with computed numbers that are
  // kept for trends. Throws on failure.
  fetch(): Promise<string | SourceResult>;
}

export interface SourceResult {
  text: string;
  metrics?: Record<string, number>;
}
