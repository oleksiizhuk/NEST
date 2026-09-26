import { IssueFact } from '@application/project-manager/metrics';

// Зависшие: every open ticket with when it was created, last changed and
// entered its status. Ages are counted when the page is opened, so a
// snapshot a few days old still shows how long things have really hung.

export interface HangingIssue {
  key: string;
  summary: string;
  type: string;
  status: string;
  category: 'new' | 'indeterminate';
  assignee: string | null;
  priority: string | null;
  inScope: boolean;
  created: string | null;
  updated: string | null;
  statusSince: string | null;
}

export interface Hanging {
  releaseVersion: string | null;
  // The list hit its limit; it is read oldest-change first, so what is
  // missing are the most recently touched tickets
  capped: boolean;
  items: HangingIssue[];
}

export interface HangingItem
  extends Omit<HangingIssue, 'created' | 'updated' | 'statusSince'> {
  openDays: number | null;
  idleDays: number | null;
  inStatusDays: number | null;
}

const DAY = 86_400_000;
const days = (iso: string | null | undefined, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : null;

export const hangingWork = (
  open: IssueFact[],
  releaseVersion: string | null,
  capped: boolean,
): Hanging => ({
  releaseVersion,
  capped,
  items: open
    .filter((i) => i.category !== 'done' && !/^epic$|^эпик$/i.test(i.type))
    .map((i) => ({
      key: i.key,
      summary: (i.summary ?? '').slice(0, 140),
      type: i.type,
      status: i.status,
      category: i.category as 'new' | 'indeterminate',
      assignee: i.assignee,
      priority: i.priority,
      inScope: releaseVersion ? i.fixVersions.includes(releaseVersion) : false,
      created: i.created,
      updated: i.updated ?? null,
      statusSince: i.statusSince,
    })),
});

// Ages as of `now`, the longest untouched first
export const hangingAges = (items: HangingIssue[], now: Date): HangingItem[] =>
  items
    .map(({ created, updated, statusSince, ...rest }) => ({
      ...rest,
      openDays: days(created, now),
      idleDays: days(updated, now),
      inStatusDays: days(statusSince, now),
    }))
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));
