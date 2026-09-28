import { Model } from 'mongoose';
import { MongoMcpTaskRepository } from '@infrastructure/database/repositories/mongo-mcp-task.repository';
import { McpTaskDocument } from '@infrastructure/database/schemas/mcp-task.schema';

const row = (patch: Record<string, unknown> = {}) => ({
  taskId: 't-0000000001',
  goal: 'fix login',
  checklist: ['the error'],
  status: 'answered',
  rounds: 2,
  history: [{ at: '2026-09-28T10:00:00Z', kind: 'answer', note: 'h' }],
  createdAt: '2026-09-28T09:00:00Z',
  updatedAt: '2026-09-28T10:00:00Z',
  ...patch,
});

const OPEN = { $in: ['gathering', 'answered', 'not_solved', 'partial'] };

// The atomic guarantees live in the filters, so the specs pin them
describe('MongoMcpTaskRepository', () => {
  const lean = (value: unknown) => ({
    lean: jest.fn().mockResolvedValue(value),
  });
  let model: Record<string, jest.Mock>;
  let repo: MongoMcpTaskRepository;

  beforeEach(() => {
    model = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
      find: jest.fn(),
    };
    repo = new MongoMcpTaskRepository(
      model as unknown as Model<McpTaskDocument>,
    );
  });

  it('claims a round only on an open task under the cap', async () => {
    model.findOneAndUpdate.mockReturnValue(lean(row({ rounds: 3 })));

    const task = await repo.claimRound('t-0000000001', 5);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { taskId: 't-0000000001', status: OPEN, rounds: { $lt: 5 } },
      { $inc: { rounds: 1 } },
      { new: true },
    );
    expect(task.rounds).toBe(3);
    expect(task.history[0].at).toEqual(new Date('2026-09-28T10:00:00Z'));
  });

  it('returns null when no round could be claimed', async () => {
    model.findOneAndUpdate.mockReturnValue(lean(null));
    expect(await repo.claimRound('t-0000000001', 5)).toBeNull();
  });

  it('records a reply and a report only while the task is open, capping history', async () => {
    const event = {
      at: new Date(),
      kind: 'need_info' as const,
      note: 'send a.ts',
    };
    await repo.recordReply('t-0000000001', event);
    expect(model.updateOne).toHaveBeenCalledWith(
      { taskId: 't-0000000001', status: OPEN },
      {
        $set: { status: 'gathering' },
        $push: { history: { $each: [event], $slice: -20 } },
      },
    );

    model.findOneAndUpdate.mockReturnValue(lean(row({ status: 'solved' })));
    const report = {
      ...event,
      kind: 'report' as const,
      outcome: 'solved' as const,
    };
    const task = await repo.report('t-0000000001', 'solved', report);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { taskId: 't-0000000001', status: OPEN },
      {
        $set: { status: 'solved' },
        $push: { history: { $each: [report], $slice: -20 } },
      },
      { new: true },
    );
    expect(task.isOpen).toBe(false);
  });

  it('lists open tasks, most recently touched first', async () => {
    const limit = jest.fn().mockReturnValue(lean([row()]));
    const sort = jest.fn().mockReturnValue({ limit });
    model.find.mockReturnValue({ sort });

    const open = await repo.listOpen(20);

    expect(model.find).toHaveBeenCalledWith({ status: OPEN });
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(limit).toHaveBeenCalledWith(20);
    expect(open.map((t) => t.id)).toEqual(['t-0000000001']);
  });
});
