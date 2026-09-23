export const PM_MEMORY = 'PM_MEMORY';

export type MemoryKind = 'decision' | 'fact' | 'commitment' | 'person';
export const MEMORY_KINDS: MemoryKind[] = [
  'decision',
  'fact',
  'commitment',
  'person',
];

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  text: string;
  // For commitments: when it is due
  dueAt: Date | null;
  createdAt: Date;
  // null = kept until removed
  expiresAt: Date | null;
  // Who asked the bot to remember it
  author: string;
}

// What the team asked the bot to remember: decisions, facts, promises with a
// due date, people's roles. Written only through a confirmed proposal.
export interface IPmMemory {
  add(record: Omit<MemoryRecord, 'id' | 'createdAt'>): Promise<MemoryRecord>;
  // Not expired at `now`, oldest first (stable for the prompt cache)
  active(now: Date): Promise<MemoryRecord[]>;
  remove(id: string): Promise<boolean>;
}

const DAY_MS = 86_400_000;

// How long each kind stays: decisions a quarter, facts a month, promises a
// week past their due date, people until removed
export const memoryExpiry = (
  kind: MemoryKind,
  now: Date,
  dueAt: Date | null,
): Date | null => {
  switch (kind) {
    case 'decision':
      return new Date(now.getTime() + 90 * DAY_MS);
    case 'fact':
      return new Date(now.getTime() + 30 * DAY_MS);
    case 'commitment':
      return new Date((dueAt ?? now).getTime() + (dueAt ? 7 : 30) * DAY_MS);
    default:
      return null;
  }
};

const MAX_MEMORY_CHARS = 8_000;

// Newest records win when the block is over budget; order stays oldest first
export const renderMemory = (records: MemoryRecord[]): string => {
  const lines = records.map(
    (r) =>
      `- [${r.id}] ${r.kind}, ${r.createdAt.toISOString().slice(0, 10)}${
        r.dueAt ? `, due ${r.dueAt.toISOString().slice(0, 10)}` : ''
      }, from ${r.author}: ${r.text}`,
  );
  let total = 0;
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    total += lines[i].length + 1;
    if (total > MAX_MEMORY_CHARS) break;
    kept.unshift(lines[i]);
  }
  return kept.length ? `<memory>\n${kept.join('\n')}\n</memory>` : '';
};
