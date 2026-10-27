export const PM_PROPOSALS = 'PM_PROPOSALS';

// Personal mode: what is in the way of the person's work, and one step that
// would move it. The owner rates each one with a button; ratings steer the
// next proposals and keep a rejected one from coming back.
export const BLOCKER_KINDS = [
  'backend',
  'design',
  'client',
  'review',
  'qa',
  'build',
  'requirements',
  'other',
] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

export type ProposalStatus = 'sent' | 'accepted' | 'snoozed' | 'rejected';
export type ProposalRating = Exclude<ProposalStatus, 'sent'>;

export interface ProposalDraft {
  keys: string[];
  kind: BlockerKind;
  // What is in the way, one sentence
  blocker: string;
  // The suggested step
  step: string;
  // Who to ask, if anyone
  ask: string | null;
  // A ready message to send them
  draft: string | null;
}

export interface Proposal extends ProposalDraft {
  id: string;
  // kind + keys: the same blocker on the same tickets
  fingerprint: string;
  status: ProposalStatus;
  createdAt: Date;
  ratedAt: Date | null;
}

// Without tickets, the blocker's first words tell proposals apart
export const fingerprintOf = (
  p: Pick<ProposalDraft, 'kind' | 'keys'> & { blocker?: string },
) =>
  `${p.kind}|${
    p.keys.length
      ? [...p.keys].sort().join(',')
      : `~${(p.blocker ?? '')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim()
          .slice(0, 40)}`
  }`;

export interface IProposalStore {
  // Stores new proposals; returns them with ids
  add(drafts: ProposalDraft[], now: Date): Promise<Proposal[]>;
  // Rates a proposal still waiting for one (atomic); null if it was already
  // rated or does not exist
  rate(id: string, rating: ProposalRating, now: Date): Promise<Proposal | null>;
  // Newest first, for the feedback block and the dedupe
  recent(since: Date, limit: number): Promise<Proposal[]>;
}

// How long a proposal keeps the same blocker on the same tickets from being
// proposed again
const QUIET_DAYS: Record<ProposalStatus, number> = {
  sent: 2,
  snoozed: 3,
  accepted: 14,
  rejected: 30,
};
export const QUIET_WINDOW_DAYS = Math.max(...Object.values(QUIET_DAYS));

export const quietFingerprints = (recent: Proposal[], now: Date): Set<string> =>
  new Set(
    recent
      .filter(
        (p) =>
          now.getTime() - (p.ratedAt ?? p.createdAt).getTime() <
          QUIET_DAYS[p.status] * 86_400_000,
      )
      .map((p) => p.fingerprint),
  );

const clean = (s: string, max: number) =>
  s
    .replace(/[<>\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);

// Goes into the next prompt after the cached prefix: what the owner took,
// put off and turned down, and what must not be proposed again yet
export const renderProposalFeedback = (
  recent: Proposal[],
  now: Date,
): string => {
  const rated = recent.filter((p) => p.status !== 'sent').slice(0, 12);
  const quiet = quietFingerprints(recent, now);
  if (!rated.length && !quiet.size) return '';
  const label: Record<ProposalStatus, string> = {
    accepted: 'TAKEN',
    snoozed: 'LATER',
    rejected: 'NOT USEFUL',
    sent: 'no answer yet',
  };
  return [
    '<past_proposals>',
    ...rated.map(
      (p) =>
        `- ${label[p.status]}: [${p.kind}] ${p.keys.join(', ')} — ${clean(
          p.step,
          200,
        )}`,
    ),
    ...(quiet.size
      ? [`Do not propose again yet (kind|tickets): ${[...quiet].join('; ')}`]
      : []),
    '</past_proposals>',
  ].join('\n');
};

const KEY = /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/;
const MAX_PROPOSALS = 3;

// The digest carries a ```proposals JSON block, meant to be last. The last
// such fence is the one (an earlier fence may quote a log); text after its
// closing fence stays, and the block never reaches the owner as raw JSON,
// even when it is broken or cut off. Returns the text without it and the
// valid proposals (at most 3, none that must stay quiet).
export const takeProposals = (
  written: string,
  quiet: Set<string> = new Set(),
): { text: string; proposals: ProposalDraft[] } => {
  const open = written.lastIndexOf('```proposals');
  if (open < 0) return { text: written, proposals: [] };
  const bodyAt = open + '```proposals'.length;
  const close = written.indexOf('```', bodyAt);
  const body = written.slice(bodyAt, close < 0 ? undefined : close);
  const after = close < 0 ? '' : written.slice(close + 3).trim();
  const text = [written.slice(0, open).trimEnd(), after]
    .filter(Boolean)
    .join('\n\n');
  let raw: unknown;
  try {
    raw = JSON.parse(body.trim());
  } catch {
    return { text, proposals: [] };
  }
  if (!Array.isArray(raw)) return { text, proposals: [] };
  const out: ProposalDraft[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const keys = (Array.isArray(r.keys) ? r.keys : [])
      .map((k) => String(k).trim().toUpperCase())
      .filter((k) => KEY.test(k))
      .slice(0, 5);
    const kind = BLOCKER_KINDS.find((k) => k === r.kind) ?? 'other';
    const step = clean(String(r.step ?? ''), 400);
    const blocker = clean(String(r.blocker ?? ''), 300);
    if (!step || !blocker) continue;
    const draft: ProposalDraft = {
      keys,
      kind,
      blocker,
      step,
      ask: r.ask ? clean(String(r.ask), 80) || null : null,
      draft: r.draft ? clean(String(r.draft), 600) || null : null,
    };
    const fp = fingerprintOf(draft);
    if (quiet.has(fp) || seen.has(fp)) continue;
    seen.add(fp);
    out.push(draft);
    if (out.length === MAX_PROPOSALS) break;
  }
  return { text, proposals: out };
};

// Callback data: "pp:<id>:<a|s|r>" take / later / not useful; "x" answers a
// press on a proposal that is already rated
export const PROPOSAL_ACTIONS: Record<string, ProposalRating | null> = {
  a: 'accepted',
  s: 'snoozed',
  r: 'rejected',
  x: null,
};

export const proposalButtons = (p: Pick<Proposal, 'id' | 'status'>) =>
  p.status === 'accepted'
    ? [[{ text: '✅ Беру — отмечено', data: `pp:${p.id}:x` }]]
    : p.status === 'rejected'
    ? [[{ text: '❌ Не то — отмечено', data: `pp:${p.id}:x` }]]
    : [
        [
          { text: '✅ Беру', data: `pp:${p.id}:a` },
          ...(p.status === 'snoozed'
            ? []
            : [{ text: '⏳ Позже', data: `pp:${p.id}:s` }]),
          { text: '❌ Не то', data: `pp:${p.id}:r` },
        ],
      ];

export const proposalText = (p: ProposalDraft): string =>
  [
    `💡 ${p.keys.length ? `${p.keys.join(', ')} · ` : ''}${p.blocker}`,
    `Шаг: ${p.step}`,
    p.ask ? `Кого спросить: ${p.ask}` : '',
    p.draft ? `Черновик: «${p.draft}»` : '',
  ]
    .filter(Boolean)
    .join('\n');
