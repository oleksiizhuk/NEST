export const PM_ADMIN_APPROVALS = 'PM_ADMIN_APPROVALS';

export type ApprovalState =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'unknown';

// A password login waiting for the owner's tap in Telegram
export interface IAdminApprovals {
  // A new request id (unguessable); null when too many are open
  create(now: Date): Promise<string | null>;
  // The owner's answer from the bot; returns the state it ended in
  decide(id: string, approve: boolean, now: Date): Promise<ApprovalState>;
  // Polled by the login page. "approved" is returned once, then the
  // request is spent, so a session is issued a single time.
  take(id: string, now: Date): Promise<ApprovalState>;
  // True when the owner denied a login since `since`
  deniedSince(since: Date): Promise<boolean>;
}
