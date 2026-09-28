import { Model } from 'mongoose';
import { MongoMcpUsageRepository } from '@infrastructure/database/repositories/mongo-mcp-usage.repository';
import { McpUsageDocument } from '@infrastructure/database/schemas/mcp-usage.schema';

describe('MongoMcpUsageRepository', () => {
  it('reads the paid and free counters the daily limit keeps', async () => {
    const lean = jest.fn().mockResolvedValue([
      { day: '2026-09-28', count: 14 },
      { day: '2026-09-28:free', count: 6 },
      { day: '2026-09-28:refused', count: 4 },
      { day: '2026-09-28:refusedFree', count: 2 },
    ]);
    const model = { find: jest.fn().mockReturnValue({ lean }) };
    const repo = new MongoMcpUsageRepository(
      model as unknown as Model<McpUsageDocument>,
    );

    expect(await repo.usageOn('2026-09-28')).toEqual({
      units: 14,
      free: 6,
      refused: 4,
      refusedFree: 2,
    });
    expect(model.find).toHaveBeenCalledWith({
      day: {
        $in: [
          '2026-09-28',
          '2026-09-28:free',
          '2026-09-28:refused',
          '2026-09-28:refusedFree',
        ],
      },
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
    expect(await repo.usageOn('2026-09-28')).toEqual({
      units: 0,
      free: 0,
      refused: 0,
      refusedFree: 0,
    });
  });

  it('increments atomically, retrying once on a first-of-day duplicate-key race', async () => {
    const findOneAndUpdate = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }))
      .mockResolvedValueOnce({ count: 3 });
    const repo = new MongoMcpUsageRepository({
      findOneAndUpdate,
    } as unknown as Model<McpUsageDocument>);

    expect(await repo.increment('2026-09-28', 2)).toBe(3);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { day: '2026-09-28' },
      { $inc: { count: 2 } },
      { upsert: true, new: true },
    );
  });

  it('gives units back without ever throwing', async () => {
    const updateOne = jest.fn().mockRejectedValue(new Error('down'));
    const repo = new MongoMcpUsageRepository({
      updateOne,
    } as unknown as Model<McpUsageDocument>);

    await expect(repo.giveBack('2026-09-28', 4)).resolves.toBeUndefined();
    expect(updateOne).toHaveBeenCalledWith(
      { day: '2026-09-28' },
      { $inc: { count: -4 } },
    );
  });
});
