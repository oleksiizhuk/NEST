import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IMcpUsageRepository,
  McpDayUsage,
} from '@domain/mcp-task/mcp-usage.repository.interface';
import { McpUsageDocument } from '@infrastructure/database/schemas/mcp-usage.schema';
import { usageKey } from '@application/mcp/mcp-budget';

// Reads the counters McpDailyLimitGuard keeps (keys from mcp-budget)
@Injectable()
export class MongoMcpUsageRepository implements IMcpUsageRepository {
  constructor(
    @InjectModel(McpUsageDocument.name)
    private readonly usage: Model<McpUsageDocument>,
  ) {}

  async usageOn(day: string): Promise<McpDayUsage> {
    const paid = usageKey(day, 'paid');
    const free = usageKey(day, 'free');
    const rows = await this.usage.find({ day: { $in: [paid, free] } }).lean();
    const count = (key: string) => rows.find((r) => r.day === key)?.count ?? 0;
    return { units: count(paid), free: count(free) };
  }
}
