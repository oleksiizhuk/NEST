export const PM_ADMIN_LINKS = 'PM_ADMIN_LINKS';

// One-time login links to the admin page, sent by the bot to the owner
export interface IAdminLinks {
  // A link valid for a few minutes, usable once, for this Telegram user
  issue(now: Date, userId: number): Promise<string>;
  // The link's user id once for a valid, unexpired, unused token, else null
  consume(token: string, now: Date): Promise<number | null>;
}
