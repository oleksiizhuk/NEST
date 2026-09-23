import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IQuota } from '@application/project-manager/quota.interface';
import { PmQuotaDocument } from '@infrastructure/database/schemas/pm-quota.schema';

@Injectable()
export class MongoQuota implements IQuota {
  constructor(
    @InjectModel('PmQuota') private readonly model: Model<PmQuotaDocument>,
  ) {}

  // One atomic upsert + increment: two messages at once both count
  async hit(userId: number, day: string): Promise<number> {
    const doc = await this.model
      .findOneAndUpdate(
        { userId, day },
        { $inc: { count: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean();
    return doc?.count ?? 1;
  }
}
