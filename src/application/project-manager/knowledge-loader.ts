import {
  IKnowledgeStore,
  KnowledgeDoc,
} from '@application/project-manager/knowledge.interface';

// The brief lives in the knowledge store so it can change without a
// redeploy; the env brief is the fallback
export const BRIEF_KEY = 'core:brief';
// Keys with this prefix are always read on demand, whatever their size
const ON_DEMAND_PREFIX = 'ref:';
export const DEFAULT_INLINE_CHARS = 60_000;

export interface LoadedKnowledge {
  // Rendered for the cached prompt: short docs in full, an index of the rest
  text: string;
  brief: string | null;
  // Docs the model reads with read_knowledge
  onDemand: KnowledgeDoc[];
}

const day = (d: Date): string =>
  Number.isNaN(d.getTime()) ? '?' : d.toISOString().slice(0, 10);

const firstLine = (text: string): string =>
  (text.split('\n').find((l) => l.trim()) ?? '')
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, 160);

// Deterministic for the same store content, so the prompt cache holds.
// When the inline docs exceed the budget, the largest move to the index
// first: a big map read on demand costs one tool call, while carrying it
// inline costs tokens on every question.
export const loadKnowledge = async (
  store: IKnowledgeStore,
  budget = DEFAULT_INLINE_CHARS,
): Promise<LoadedKnowledge> => {
  const docs = await store.all().catch(() => [] as KnowledgeDoc[]);
  const brief = docs.find((d) => d.key === BRIEF_KEY)?.text ?? null;
  const rest = docs.filter((d) => d.key !== BRIEF_KEY);

  const onDemand = new Set(
    rest.filter((d) => d.key.startsWith(ON_DEMAND_PREFIX)).map((d) => d.key),
  );
  let inlineChars = rest
    .filter((d) => !onDemand.has(d.key))
    .reduce((n, d) => n + d.text.length, 0);
  const largestFirst = rest
    .filter((d) => !onDemand.has(d.key))
    .sort(
      (a, b) => b.text.length - a.text.length || a.key.localeCompare(b.key),
    );
  for (const doc of largestFirst) {
    if (inlineChars <= budget) break;
    onDemand.add(doc.key);
    inlineChars -= doc.text.length;
  }

  const inline = rest
    .filter((d) => !onDemand.has(d.key))
    .map(
      (d) =>
        `<doc key="${d.key}" updated="${day(d.updatedAt)}">\n${d.text}\n</doc>`,
    );
  const indexed = rest.filter((d) => onDemand.has(d.key));
  const index = indexed.length
    ? `<doc_index note="not loaded; read with read_knowledge">\n${indexed
        .map(
          (d) =>
            `- ${d.key} (${d.text.length} chars, updated ${day(
              d.updatedAt,
            )}): ${firstLine(d.text)}`,
        )
        .join('\n')}\n</doc_index>`
    : '';

  return {
    text: [...inline, index].filter(Boolean).join('\n'),
    brief,
    onDemand: indexed,
  };
};
