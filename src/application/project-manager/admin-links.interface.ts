export const PM_ADMIN_LINKS = 'PM_ADMIN_LINKS';

// One-time login links to the admin page, sent by the bot to the owner
export interface IAdminLinks {
  // A link valid for a few minutes, usable once
  issue(now: Date): Promise<string>;
  // True once for a valid, unexpired, unused token
  consume(token: string, now: Date): Promise<boolean>;
}
