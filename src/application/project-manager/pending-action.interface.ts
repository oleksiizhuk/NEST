import {
  BrandTarget,
  NewBrand,
  NewProperty,
  PropertyTarget,
  StoreEdit,
} from '@application/project-manager/staging-admin.interface';

export const PENDING_ACTIONS = 'PENDING_ACTIONS';

export type ActionStatus =
  | 'pending'
  | 'executing'
  | 'done'
  | 'failed'
  | 'unknown'
  | 'cancelled';

export type ActionKind =
  | 'create_brand'
  | 'publish_brand'
  | 'unpublish_brand'
  | 'delete_brand'
  | 'update_store'
  | 'create_property'
  | 'publish_property'
  | 'unpublish_property'
  | 'remember';

// A memory record waiting for confirmation
export interface MemoryProposal {
  kind: 'decision' | 'fact' | 'commitment' | 'person';
  text: string;
  // YYYY-MM-DD, commitments only
  dueAt: string | null;
  author: string;
  tier?: undefined;
  role?: undefined;
}

export interface PendingAction {
  id: string;
  kind: ActionKind;
  payload:
    | NewBrand
    | BrandTarget
    | StoreEdit
    | NewProperty
    | PropertyTarget
    | MemoryProposal;
  summary: string;
  chatId: number;
  requesterId: number;
  status: ActionStatus;
  expiresAt: Date;
  result: string | null;
}

export interface IPendingActions {
  create(
    action: Omit<PendingAction, 'id' | 'status' | 'result'>,
  ): Promise<PendingAction>;
  // Atomically moves a live pending action to executing; null if it is not
  // pending any more, expired, or belongs to another chat
  claim(
    id: string,
    chatId: number,
    confirmedBy: number,
    now: Date,
  ): Promise<PendingAction | null>;
  // The newest live pending action in a chat (for a bare "да")
  latestPending(chatId: number, now: Date): Promise<PendingAction | null>;
  finish(id: string, status: ActionStatus, result: string): Promise<void>;
  cancel(id: string, chatId: number): Promise<boolean>;
  // Newest first, for diagnostics
  recent(limit: number): Promise<Array<PendingAction & { createdAt: Date }>>;
}
