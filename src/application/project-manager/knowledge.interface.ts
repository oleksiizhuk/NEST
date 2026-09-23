export const PM_KNOWLEDGE = 'PM_KNOWLEDGE';

export interface KnowledgeDoc {
  key: string;
  text: string;
  updatedAt: Date;
}

// Long-lived reference text kept out of the public repo: codebase maps,
// API notes. Loaded into the cached part of the prompt.
export interface IKnowledgeStore {
  all(): Promise<KnowledgeDoc[]>;
  upsert(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
}
