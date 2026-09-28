import { Model } from 'mongoose';
import { MongoMcpUsageRepository } from '@infrastructure/database/repositories/mongo-mcp-usage.repository';
import { McpUsageDocument } from '@infrastructure/database/schemas/mcp-usage.schema';

describe('MongoMcpUsageRepository', () => {
  it('reads the paid and free counters the daily limit keeps', async () => {
    const lean = jest.fn().mockResolvedValue([
      { day: '2026-09-28', count: 14 },
      { day: '2026-09-28:free', count: 6 },
    ]);
    const model = { find: jest.fn().mockReturnValue({ lean }) };
    const repo = new MongoMcpUsageRepository(
      model as unknown as Model<McpUsageDocument>,
    );

    expect(await repo.usageOn('2026-09-28')).toEqual({ units: 14, free: 6 });
    expect(model.find).toHaveBeenCalledWith({
      day: { $in: ['2026-09-28', '2026-09-28:free'] },
    });
  });

  it('reads a day with no calls as zero', async () => {
    const model = {
      find: jest
        .fn()
        .mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    };
    const repo = new MongoMcpUsageRepository(
      model as unknown as Model<McpUsageDocument>,
    );
    expect(await repo.usageOn('2026-09-28')).toEqual({ units: 0, free: 0 });
  });
});
