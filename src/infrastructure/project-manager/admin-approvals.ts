import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  ApprovalState,
  IAdminApprovals,
} from '@application/project-manager/admin-approvals.interface';
import { PmAdminApprovalDocument } from '@infrastructure/database/schemas/pm-admin-approval.schema';

export const APPROVAL_TTL_MS = 2 * 60_000;
// Someone with the password cannot flood the owner with requests
const MAX_OPEN = 3;
const ID = /^[a-f0-9]{32}$/;

@Injectable()
export class MongoAdminApprovals implements IAdminApprovals {
  constructor(
    @InjectModel('PmAdminApproval')
    private readonly model: Model<PmAdminApprovalDocument>,
  ) {}

  async create(now: Date): Promise<string | null> {
    const open = await this.model.countDocuments({
      status: 'pending',
      expiresAt: { $gt: now },
    });
    if (open >= MAX_OPEN) return null;
    const requestId = randomBytes(16).toString('hex');
    await this.model.create({
      requestId,
      status: 'pending',
      expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
    });
    return requestId;
  }

  async decide(
    id: string,
    approve: boolean,
    now: Date,
  ): Promise<ApprovalState> {
    if (!ID.test(id)) return 'unknown';
    const doc = await this.model.findOneAndUpdate(
      { requestId: id, status: 'pending', expiresAt: { $gt: now } },
      { $set: { status: approve ? 'approved' : 'denied' } },
      { new: true },
    );
    if (doc) return doc.status as ApprovalState;
    const existing = await this.model.findOne({ requestId: id }).lean();
    if (!existing) return 'unknown';
    if (existing.status === 'pending') return 'expired';
    return existing.status === 'spent'
      ? 'approved'
      : (existing.status as ApprovalState);
  }

  async deniedSince(since: Date): Promise<boolean> {
    return Boolean(
      await this.model.exists({ status: 'denied', createdAt: { $gte: since } }),
    );
  }

  async take(id: string, now: Date): Promise<ApprovalState> {
    if (!ID.test(id)) return 'unknown';
    // Atomic: an approved request turns into a session exactly once
    const spent = await this.model.findOneAndUpdate(
      { requestId: id, status: 'approved' },
      { $set: { status: 'spent' } },
    );
    if (spent) return 'approved';
    const doc = await this.model.findOne({ requestId: id }).lean();
    if (!doc || doc.status === 'spent') return 'unknown';
    if (doc.status === 'pending')
      return new Date(doc.expiresAt) > now ? 'pending' : 'expired';
    return doc.status as ApprovalState;
  }
}
