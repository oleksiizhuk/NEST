import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ITeamReviews,
  ReviewKind,
} from '@application/project-manager/team-reviews.interface';
import { PmTeamReviewDocument } from '@infrastructure/database/schemas/pm-team-review.schema';

@Injectable()
export class MongoTeamReviews implements ITeamReviews {
  constructor(
    @InjectModel('PmTeamReview')
    private readonly model: Model<PmTeamReviewDocument>,
  ) {}

  async latest(
    kind: ReviewKind = 'meeting',
  ): Promise<{ text: string; at: Date } | null> {
    const filter =
      kind === 'meeting'
        ? { $or: [{ kind: 'meeting' }, { kind: { $exists: false } }] }
        : { kind };
    const doc = await this.model.findOne(filter).sort({ at: -1 }).lean();
    return doc ? { text: doc.text, at: new Date(doc.at) } : null;
  }

  async save(
    text: string,
    at: Date,
    kind: ReviewKind = 'meeting',
  ): Promise<void> {
    await this.model.create({ text, at, kind });
  }
}
