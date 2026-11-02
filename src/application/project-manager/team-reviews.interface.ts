export const PM_TEAM_REVIEWS = 'PM_TEAM_REVIEWS';

// The model's meeting notes about the team, kept so reopening the page does
// not bill another analysis
// meeting (the default), standup, retro, 1:1 with one person, or a report
// on one person asked for in Telegram (/report)
export type ReviewKind =
  | 'meeting'
  | 'standup'
  | 'retro'
  | `oneonone:${string}`
  | `report:${string}`;
// What the admin page asks review() for: a report is only ever written by
// personReport(), so meeting notes cannot land under a person's report
export type MeetingKind = Exclude<ReviewKind, `report:${string}`>;

export interface ITeamReviews {
  latest(kind?: ReviewKind): Promise<{ text: string; at: Date } | null>;
  save(text: string, at: Date, kind?: ReviewKind): Promise<void>;
  // Notes written since `since`, all kinds: the daily cap on model calls
  countSince(since: Date): Promise<number>;
}
