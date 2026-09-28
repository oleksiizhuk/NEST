// A problem an IDE assistant is working through with the /mcp bridge: what
// to collect, each round of advice, and the caller's report of whether it
// worked. The caller is often a weak model that loses the thread, so the
// state lives here, and a task stays open until someone reports on it.

import { randomBytes } from 'crypto';

// abandoned: the caller dropped the task; it closes without claiming success
export const MCP_OUTCOMES = [
  'solved',
  'not_solved',
  'partial',
  'abandoned',
] as const;
export type McpOutcome = (typeof MCP_OUTCOMES)[number];

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
  | 'escalated'
  | 'abandoned';
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

// Credentials in what callers write: an identifier ending in a secret-ish
// word with its value (quoted or not), passwords inside connection strings,
// Authorization schemes, and long random-looking runs. Paths and ordinary
// words ("tokenizer", "keyboard", "tokens: 5") are left alone.
const KEYED_SECRET =
  /(["']?)\b([A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|pass|pwd|credentials?|key))\1(\s*(?:=>|[=:])\s*)(?:"[^"]*"|'[^']*'|[^\s"',;]+)/gi;
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]*:)[^\s@/]+@/gi;
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi;
// Mixed letters and digits, 32+ long. No slashes: file paths matter more
// to the protocol than a slashed secret in prose (best effort, not a DLP)
const RANDOM_RUN =
  /\b(?=[A-Za-z0-9_+=-]*\d)(?=[A-Za-z0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{32,}/g;

// Rounds given back after failures (errors, refusals, a budget spent on
// thinking) are still paid for: this many and the task goes to a person
export const MAX_FAILED_ATTEMPTS = 3;

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
    // Rounds given back because the model gave no answer
    public readonly failures = 0,
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

  get outOfAttempts(): boolean {
    return this.failures >= MAX_FAILED_ATTEMPTS;
  }

  // Out of rounds or attempts, the task goes to a person — but only once no
  // round is running and the last answer is not waiting for its report
  shouldEscalate(now: Date): boolean {
    return (
      this.isOpen &&
      (this.onLastRound || this.outOfAttempts) &&
      !this.roundInFlight(now) &&
      !this.awaitingReport
    );
  }

  // 40 random bits: the id is also the capability to act on the task, since
  // every client shares one token (lists are scoped by client, ids are not)
  static newId(): string {
    return `t-${randomBytes(5).toString('hex')}`;
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
      .replace(URL_PASSWORD, '$1***@')
      .replace(AUTH_SCHEME, '$1 ***')
      .replace(KEYED_SECRET, '$1$2$1$3***')
      .replace(RANDOM_RUN, '***')
      .replace(/</g, '‹')
      .replace(/>/g, '›');
    if (oneLine) t = t.replace(/\s+/g, ' ');
    return McpTask.clip(t, max);
  }
}
