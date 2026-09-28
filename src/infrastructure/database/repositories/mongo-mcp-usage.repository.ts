import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IMcpUsageRepository,
  McpDayUsage,
} from '@domain/mcp-task/mcp-usage.repository.interface';
import { McpUsageDocument } from '@infrastructure/database/schemas/mcp-usage.schema';

// Reads the counters McpDailyLimitGuard keeps: one row per day for paid
// units, one per day with a ":free" suffix for the free tools
@Injectable()
export class MongoMcpUsageRepository implements IMcpUsageRepository {
  constructor(
    @InjectModel(McpUsageDocument.name)
    private readonly usage: Model<McpUsageDocument>,
  ) {}

  async usageOn(day: string): Promise<McpDayUsage> {
    const rows = await this.usage
      .find({ day: { $in: [day, `${day}:free`] } })
      .lean();
    const count = (key: string) => rows.find((r) => r.day === key)?.count ?? 0;
    return { units: count(day), free: count(`${day}:free`) };
  }
}
