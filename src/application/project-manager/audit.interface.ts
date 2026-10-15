export const PM_AUDITS = 'PM_AUDITS';

// The consistency audit: every 3 days the model compares the design, the web
// client, the mobile app and the backend, and the team gets two checklists in
// Telegram (tech for the developers, design for everyone). A tap on an item
// marks that someone has looked at it; it is not "fixed".

// tech: web / mobile / backend differences; design: design vs implementation
export type AuditKind = 'tech' | 'design';

// One pass of the model over one comparison (one model call with tools)
export type AuditPhase =
  | 'design-web'
  | 'design-mobile'
  | 'web-mobile'
  | 'clients-backend'
  | 'compose'
  | 'post';

export const AUDIT_PHASES: AuditPhase[] = [
  'design-web',
  'design-mobile',
  'web-mobile',
  'clients-backend',
  'compose',
  'post',
];

export interface AuditCheck {
  userId: number;
  name: string;
  at: Date;
}

export interface AuditItem {
  kind: AuditKind;
  // Position within its kind, 0-based; the button data uses it
  index: number;
  // Short, for the button (≤ 40 chars)
  title: string;
  // One or two sentences: what differs, where (paths / screens), what to do
  detail: string;
  // web / mobile / backend / design, any that apply
  areas: string[];
  // Also in the previous run and still present
  repeat: boolean;
  checkedBy: AuditCheck | null;
}

export interface AuditPost {
  kind: AuditKind;
  chatId: number;
  messageId: number;
}

export interface AuditRun {
  // 8 lowercase hex; goes into the button data `ck:<runId>:<t|d><index>`
  runId: string;
  status: 'running' | 'posted' | 'failed';
  // Next phase to run
  phase: AuditPhase;
  // Raw model findings per finished comparison phase (skipped → note)
  findings: Partial<Record<AuditPhase, string>>;
  items: AuditItem[];
  posts: AuditPost[];
  // Failed tries of the current phase; 2 failures fail the run
  attempts: number;
  error: string | null;
  // Who started it: the cron or an admin (Telegram user id)
  startedBy: 'cron' | number;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface IAuditStore {
  // The newest run, any status
  latest(): Promise<AuditRun | null>;
  // The newest run that reached the team; compose marks repeats against it
  lastPosted(): Promise<AuditRun | null>;
  get(runId: string): Promise<AuditRun | null>;
  // Inserts a run unless one is running (unique partial index on status
  // 'running'); returns null when another run holds it
  create(run: AuditRun): Promise<AuditRun | null>;
  // Saves phase progress; only while the run is still 'running'
  update(
    runId: string,
    patch: Partial<
      Pick<
        AuditRun,
        | 'phase'
        | 'findings'
        | 'items'
        | 'posts'
        | 'attempts'
        | 'error'
        | 'status'
        | 'finishedAt'
      >
    >,
  ): Promise<AuditRun | null>;
  // Atomically flips one item's check (set when empty, cleared when set)
  // and returns the run after the change; null when no such item
  toggle(
    runId: string,
    kind: AuditKind,
    index: number,
    who: AuditCheck,
  ): Promise<AuditRun | null>;
  // Takes the run for one step until `until`, so two cron slots or the admin
  // page cannot run the same phase at once; null when it is busy
  claimStep(runId: string, until: Date): Promise<AuditRun | null>;
  releaseStep(runId: string): Promise<void>;
}
