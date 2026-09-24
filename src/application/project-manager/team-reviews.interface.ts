export const PM_TEAM_REVIEWS = 'PM_TEAM_REVIEWS';

// The model's meeting notes about the team, kept so reopening the page does
// not bill another analysis
export interface ITeamReviews {
  latest(): Promise<{ text: string; at: Date } | null>;
  save(text: string, at: Date): Promise<void>;
}
