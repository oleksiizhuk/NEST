import { IssueFact } from '@application/project-manager/metrics';

// Зависшие: every open ticket with how long it has been open, untouched and
// in its status, so the owner can find what is quietly rotting. Calendar
// days: "висит 40 дней" is how people talk about it.

export interface HangingItem {
  key: string;
  summary: string;
  type: string;
  status: string;
  category: 'new' | 'indeterminate';
  assignee: string | null;
  priority: string | null;
  inScope: boolean;
  openDays: number | null;
  idleDays: number | null;
  inStatusDays: number | null;
}

export interface Hanging {
  releaseVersion: string | null;
  // The open list hit its limit: the oldest low-priority tickets may be
  // missing
  capped: boolean;
  items: HangingItem[];
}

const DAY = 86_400_000;
const days = (iso: string | null | undefined, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : null;

export const hangingWork = (
  open: IssueFact[],
  now: Date,
  releaseVersion: string | null,
  capped: boolean,
): Hanging => ({
  releaseVersion,
  capped,
  items: open
    .filter((i) => i.category !== 'done' && !/^epic$/i.test(i.type))
    .map((i) => ({
      key: i.key,
      summary: (i.summary ?? '').slice(0, 140),
      type: i.type,
      status: i.status,
      category: i.category as 'new' | 'indeterminate',
      assignee: i.assignee,
      priority: i.priority,
      inScope: releaseVersion ? i.fixVersions.includes(releaseVersion) : false,
      openDays: days(i.created, now),
      idleDays: days(i.updated, now),
      inStatusDays: days(i.statusSince, now),
    }))
    .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0)),
});
