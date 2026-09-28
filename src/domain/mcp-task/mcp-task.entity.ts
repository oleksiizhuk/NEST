// A problem an IDE assistant is working through with the /mcp bridge: what
// to collect, each round of advice, and the caller's report of whether it
// worked. The caller is often a weak model that loses the thread, so the
// state lives here, and a task stays open until someone reports on it.

export type McpOutcome = 'solved' | 'not_solved' | 'partial';
export const MCP_OUTCOMES: readonly McpOutcome[] = [
  'solved',
  'not_solved',
  'partial',
];

// gathering: the last reply asked for more material
// answered: advice given, waiting for the caller's report
// not_solved / partial: reported, still open for another round
// solved / escalated: closed (escalated = out of rounds, hand to a human)
export type McpTaskStatus =
  | 'gathering'
  | 'answered'
  | 'not_solved'
  | 'partial'
  | 'solved'
  | 'escalated';
export const OPEN_TASK_STATUSES: readonly McpTaskStatus[] = [
  'gathering',
  'answered',
  'not_solved',
  'partial',
];

// Rounds of advice per task: past this the problem needs a person, and more
// calls only spend money on the same guesses
export const MAX_TASK_ROUNDS = 5;
// With no call for this long an open task counts as abandoned
export const TASK_STALE_MS = 24 * 60 * 60 * 1000;

// Only short notes are kept, never the caller's code or the full answer
export const MAX_GOAL_CHARS = 500;
export const MAX_NOTE_CHARS = 2000;
export const MAX_HISTORY = 20;

export type McpTaskEventKind = 'need_info' | 'answer' | 'report';

export interface McpTaskEvent {
  at: Date;
  kind: McpTaskEventKind;
  // need_info: what was asked for; answer: the one-line hypothesis;
  // report: what the caller ran and saw
  note: string;
  outcome?: McpOutcome;
}

export class McpTask {
  constructor(
    public readonly id: string,
    public readonly goal: string,
    public readonly checklist: string[],
    public readonly status: McpTaskStatus,
    // Rounds of advice already taken
    public readonly rounds: number,
    public readonly history: McpTaskEvent[],
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  get isOpen(): boolean {
    return OPEN_TASK_STATUSES.includes(this.status);
  }

  get awaitingReport(): boolean {
    return this.status === 'answered';
  }

  isStale(now: Date): boolean {
    return (
      this.isOpen && now.getTime() - this.updatedAt.getTime() > TASK_STALE_MS
    );
  }

  static clip(text: string, max: number): string {
    const t = text.trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }
}
