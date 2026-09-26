export const PM_TEAM_REVIEWS = 'PM_TEAM_REVIEWS';

// The model's meeting notes about the team, kept so reopening the page does
// not bill another analysis
// meeting (the default), standup, retro, or 1:1 with one person
export type ReviewKind = 'meeting' | 'standup' | 'retro' | `oneonone:${string}`;

export interface ITeamReviews {
  latest(kind?: ReviewKind): Promise<{ text: string; at: Date } | null>;
  save(text: string, at: Date, kind?: ReviewKind): Promise<void>;
}
