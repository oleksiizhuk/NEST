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

// A round cannot outlive the serverless function that runs it
export const ROUND_MAX_MS = 300_000;

// Only short notes are kept, never the caller's code or the full answer
export const MAX_GOAL_CHARS = 500;
// A goal taken from the first line of a plain question
export const MAX_DERIVED_GOAL_CHARS = 200;
// What the model asked for, or its one-line hypothesis
export const MAX_REPLY_NOTE_CHARS = 300;
// The caller's own report
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

// Whoever calls with the shared token names itself with a header; tasks
// and reminders are scoped to that name
export const DEFAULT_TASK_OWNER = 'default';

// key=value / key: value where the key names a credential, and long
// token-like runs (API keys, JWTs, hashes)
const SECRET_ASSIGNMENT =
  /\b([\w.-]*(?:secret|token|passw(?:or)?d|pwd|credential|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*\s*[=:]\s*|\bkey\s*[=:]\s*)(["']?)[^\s"',;]+\2/gi;
const SECRET_RUN = /[A-Za-z0-9+/_=-]{32,}/g;

export class McpTask {
  constructor(
    public readonly id: string,
    public readonly owner: string,
    public readonly goal: string,
    public readonly checklist: string[],
    public readonly status: McpTaskStatus,
    // Rounds of advice already taken
    public readonly rounds: number,
    public readonly history: McpTaskEvent[],
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    // Set when a round is claimed, cleared when its reply is recorded or the
    // round is given back
    public readonly inFlightSince: Date | null = null,
  ) {}

  get isOpen(): boolean {
    return OPEN_TASK_STATUSES.includes(this.status);
  }

  get awaitingReport(): boolean {
    return this.status === 'answered';
  }

  // The round just taken (or the last one) is the final one
  get onLastRound(): boolean {
    return this.rounds >= MAX_TASK_ROUNDS;
  }

  isStale(now: Date): boolean {
    return (
      this.isOpen && now.getTime() - this.updatedAt.getTime() > TASK_STALE_MS
    );
  }

  // A round is running — unless the function that ran it died, hence the
  // cap: no round outlives the serverless function
  roundInFlight(now: Date): boolean {
    return (
      !!this.inFlightSince &&
      now.getTime() - this.inFlightSince.getTime() < ROUND_MAX_MS
    );
  }

  // Out of rounds, the task goes to a person — but only once no round is
  // running and the last answer is not waiting for its report
  shouldEscalate(now: Date): boolean {
    return (
      this.isOpen &&
      this.onLastRound &&
      !this.roundInFlight(now) &&
      !this.awaitingReport
    );
  }

  static statusAfterReply(kind: 'need_info' | 'answer'): McpTaskStatus {
    return kind === 'need_info' ? 'gathering' : 'answered';
  }

  static clip(text: string, max: number): string {
    const t = text.trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  // Everything kept on a task goes back to models later (into <task> and
  // tool replies), so it is stored with credentials masked and angle
  // brackets neutralised: a note cannot close the data fence it sits in
  static clean(text: string, max: number, oneLine = false): string {
    let t = text
      .replace(SECRET_ASSIGNMENT, '$1***')
      .replace(SECRET_RUN, '***')
      .replace(/</g, '‹')
      .replace(/>/g, '›');
    if (oneLine) t = t.replace(/\s+/g, ' ');
    return McpTask.clip(t, max);
  }
}
