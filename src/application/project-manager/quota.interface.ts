export const PM_QUOTA = 'PM_QUOTA';

// Counts questions per person per UTC day
export interface IQuota {
  // Adds one and returns the new count for that person and day
  hit(userId: number, day: string, username?: string | null): Promise<number>;
  // Everyone who asked on that day, most questions first
  day(
    day: string,
  ): Promise<Array<{ userId: number; username: string | null; count: number }>>;
}
