export const SEEN_JOBS = 'SEEN_JOBS';

export interface ISeenJobs {
  // True only for the first caller of a key, so a position is announced once
  claim(key: string, now: Date): Promise<boolean>;
  // Gives a key back when announcing it failed, so the next run tries again
  release(key: string): Promise<void>;
}
