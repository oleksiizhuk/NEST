import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IMcpUsageRepository,
  McpDayUsage,
} from '@domain/mcp-task/mcp-usage.repository.interface';
import { McpUsageDocument } from '@infrastructure/database/schemas/mcp-usage.schema';
import { usageKey } from '@application/mcp/mcp-budget';

// The /mcp daily counters: written by McpDailyLimitGuard, read by the stats
@Injectable()
export class MongoMcpUsageRepository implements IMcpUsageRepository {
  constructor(
    @InjectModel(McpUsageDocument.name)
    private readonly usage: Model<McpUsageDocument>,
  ) {}

  // An upsert against the unique `day` index can race two first-of-day
  // inserts into a duplicate-key error (E11000); the loser retries and, the
  // row now existing, the $inc simply applies.
  async increment(key: string, by: number): Promise<number> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const doc = await this.usage.findOneAndUpdate(
          { day: key },
          { $inc: { count: by } },
          { upsert: true, new: true },
        );
        return doc.count;
      } catch (error) {
        if ((error as { code?: number }).code === 11000 && attempt === 0) {
          continue;
        }
        throw error;
      }
    }
    /* istanbul ignore next: the loop either returns or throws above */
    return Number.POSITIVE_INFINITY;
  }

  // A failed give-back leaves the count high: the safe side
  async giveBack(key: string, by: number): Promise<void> {
    await this.usage
      .updateOne({ day: key }, { $inc: { count: -by } })
      .catch(() => undefined);
  }

  async usageOn(day: string): Promise<McpDayUsage> {
    const keys = {
      units: usageKey(day, 'paid'),
      free: usageKey(day, 'free'),
      refused: usageKey(day, 'refused'),
      refusedFree: usageKey(day, 'refusedFree'),
    };
    const rows = await this.usage
      .find({ day: { $in: Object.values(keys) } })
      .lean();
    const count = (key: string) => rows.find((r) => r.day === key)?.count ?? 0;
    return {
      units: count(keys.units),
      free: count(keys.free),
      refused: count(keys.refused),
      refusedFree: count(keys.refusedFree),
    };
  }
}
