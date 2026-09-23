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
  async hit(
    userId: number,
    day: string,
    username?: string | null,
  ): Promise<number> {
    const doc = await this.model
      .findOneAndUpdate(
        { userId, day },
        {
          $inc: { count: 1 },
          ...(username ? { $set: { username } } : {}),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean();
    return doc?.count ?? 1;
  }

  async day(
    day: string,
  ): Promise<
    Array<{ userId: number; username: string | null; count: number }>
  > {
    const docs = await this.model
      .find({ day })
      .sort({ count: -1 })
      .limit(200)
      .lean();
    return docs.map((d) => ({
      userId: d.userId,
      username: d.username ?? null,
      count: d.count,
    }));
  }
}
