import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BlockerKind,
  fingerprintOf,
  IProposalStore,
  Proposal,
  ProposalDraft,
  ProposalRating,
  ProposalStatus,
} from '@application/project-manager/proposals.interface';
import { PmProposalDocument } from '@infrastructure/database/schemas/pm-proposal.schema';

const toProposal = (d: PmProposalDocument): Proposal => ({
  id: d.proposalId,
  fingerprint: d.fingerprint,
  keys: d.keys ?? [],
  kind: d.kind as BlockerKind,
  blocker: d.blocker,
  step: d.step,
  ask: d.ask ?? null,
  draft: d.draft ?? null,
  status: d.status as ProposalStatus,
  createdAt: d.createdAt,
  ratedAt: d.ratedAt ?? null,
});

@Injectable()
export class MongoPmProposals implements IProposalStore {
  constructor(
    @InjectModel('PmProposal')
    private readonly model: Model<PmProposalDocument>,
  ) {}

  async add(drafts: ProposalDraft[], now: Date): Promise<Proposal[]> {
    if (!drafts.length) return [];
    const docs = await this.model.insertMany(
      drafts.map((d) => ({
        ...d,
        // 8 hex chars: fits the 64-byte callback data with room to spare
        proposalId: randomBytes(4).toString('hex'),
        fingerprint: fingerprintOf(d),
        status: 'sent',
        createdAt: now,
        ratedAt: null,
      })),
    );
    return docs.map((d) => toProposal(d as PmProposalDocument));
  }

  async rate(
    id: string,
    rating: ProposalRating,
    now: Date,
  ): Promise<Proposal | null> {
    // Only from "sent" or "snoozed": a double press changes nothing
    const doc = await this.model.findOneAndUpdate(
      { proposalId: id, status: { $in: ['sent', 'snoozed'] } },
      { $set: { status: rating, ratedAt: now } },
      { new: true },
    );
    return doc ? toProposal(doc) : null;
  }

  async recent(since: Date, limit: number): Promise<Proposal[]> {
    const docs = await this.model
      .find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit);
    return docs.map(toProposal);
  }
}
