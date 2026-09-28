import { Model } from 'mongoose';
import { MongoMcpTaskRepository } from '@infrastructure/database/repositories/mongo-mcp-task.repository';
import { McpTaskDocument } from '@infrastructure/database/schemas/mcp-task.schema';

const row = (patch: Record<string, unknown> = {}) => ({
  taskId: 't-0000000001',
  owner: 'kiro',
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

  it('claims a round only on an open task under both caps with no round running', async () => {
    const now = new Date('2026-09-28T12:00:00Z');
    model.findOneAndUpdate
      .mockReturnValueOnce(lean(null))
      .mockReturnValueOnce(lean(row({ rounds: 3, inFlightSince: now })));

    const task = await repo.claimRound('t-0000000001', 'kiro', 5, now);

    const open = { taskId: 't-0000000001', owner: 'kiro', status: OPEN };
    // First: take over a round whose function died, without counting it
    expect(model.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      { ...open, inFlightSince: { $lt: new Date('2026-09-28T11:55:00Z') } },
      { $set: { inFlightSince: now } },
      { new: true },
    );
    expect(model.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      {
        ...open,
        rounds: { $lt: 5 },
        failures: { $not: { $gte: 3 } },
        inFlightSince: null,
      },
      { $inc: { rounds: 1 }, $set: { inFlightSince: now } },
      { new: true },
    );
    expect(task.rounds).toBe(3);
    expect(task.owner).toBe('kiro');
    expect(task.inFlightSince).toEqual(now);
  });

  it('returns the taken-over round without a second update', async () => {
    model.findOneAndUpdate.mockReturnValueOnce(lean(row({ rounds: 2 })));

    const task = await repo.claimRound('t-0000000001', 'kiro', 5, new Date());

    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(task.rounds).toBe(2);
  });

  it('creates a task gathering, with no rounds, failures or running round', async () => {
    model.create.mockResolvedValue(
      row({
        status: 'gathering',
        rounds: 0,
        history: [],
        inFlightSince: null,
        failures: 0,
      }),
    );

    const task = await repo.create('t-0000000001', 'kiro', 'fix login', ['a']);

    expect(model.create).toHaveBeenCalledWith({
      taskId: 't-0000000001',
      owner: 'kiro',
      goal: 'fix login',
      checklist: ['a'],
      status: 'gathering',
      rounds: 0,
      history: [],
      inFlightSince: null,
      failures: 0,
    });
    expect(task).toMatchObject({
      id: 't-0000000001',
      status: 'gathering',
      rounds: 0,
      failures: 0,
      inFlightSince: null,
    });
  });

  it('returns null when no round could be claimed', async () => {
    model.findOneAndUpdate.mockReturnValue(lean(null));
    expect(
      await repo.claimRound('t-0000000001', 'kiro', 5, new Date()),
    ).toBeNull();
  });

  it('records a reply and a report only while the task is open, capping history', async () => {
    const event = {
      at: new Date(),
      kind: 'need_info' as const,
      note: 'send a.ts',
    };
    const claimedAt = new Date('2026-09-28T12:00:00Z');
    await repo.recordReply('t-0000000001', claimedAt, 'need_info', event);
    expect(model.updateOne).toHaveBeenCalledWith(
      { taskId: 't-0000000001', status: OPEN, inFlightSince: claimedAt },
      {
        $set: { status: 'gathering', inFlightSince: null },
        $push: { history: { $each: [event], $slice: -20 } },
      },
    );

    model.findOneAndUpdate.mockReturnValue(lean(row({ status: 'solved' })));
    const report = {
      ...event,
      kind: 'report' as const,
      outcome: 'solved' as const,
    };
    const now = new Date('2026-09-28T12:00:00Z');
    const task = await repo.report(
      't-0000000001',
      'kiro',
      'solved',
      report,
      now,
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        taskId: 't-0000000001',
        owner: 'kiro',
        status: OPEN,
        // Refused while a round runs
        $or: [
          { inFlightSince: null },
          { inFlightSince: { $lt: new Date('2026-09-28T11:55:00Z') } },
        ],
      },
      {
        $set: { status: 'solved' },
        $push: { history: { $each: [report], $slice: -20 } },
      },
      { new: true },
    );
    expect(task.isOpen).toBe(false);
  });

  it('escalates only an idle task whose last answer is not waiting for a report', async () => {
    await repo.escalate('t-0000000001', new Date('2026-09-28T12:00:00Z'));
    expect(model.updateOne).toHaveBeenCalledWith(
      {
        taskId: 't-0000000001',
        status: { $in: ['gathering', 'not_solved', 'partial'] },
        $or: [
          { inFlightSince: null },
          { inFlightSince: { $lt: new Date('2026-09-28T11:55:00Z') } },
        ],
      },
      { $set: { status: 'escalated' } },
    );
  });

  it('gives back only the claimed round and counts a failed attempt', async () => {
    const claimedAt = new Date('2026-09-28T12:00:00Z');
    await repo.releaseRound('t-0000000001', claimedAt);
    expect(model.updateOne).toHaveBeenCalledWith(
      { taskId: 't-0000000001', inFlightSince: claimedAt },
      {
        $inc: { rounds: -1, failures: 1 },
        $set: { inFlightSince: null },
      },
    );
  });

  it('closes an escalated task as solved only from escalated', async () => {
    model.findOneAndUpdate.mockReturnValue(lean(row({ status: 'solved' })));
    const event = { at: new Date(), kind: 'report' as const, note: 'ok' };

    await repo.resolveEscalated('t-0000000001', 'kiro', event);

    expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual({
      taskId: 't-0000000001',
      owner: 'kiro',
      status: 'escalated',
    });
  });

  it('maps an old row without owner or in-flight mark', async () => {
    const legacy: Record<string, unknown> = row();
    delete legacy.owner;
    model.findOne.mockReturnValue(lean(legacy));

    const task = await repo.findById('t-0000000001', 'default');

    expect(model.findOne).toHaveBeenCalledWith({
      taskId: 't-0000000001',
      owner: 'default',
    });
    expect(task.owner).toBe('default');
    expect(task.inFlightSince).toBeNull();
    expect(task.failures).toBe(0);
  });

  it("lists the owner's open tasks, most recently touched first", async () => {
    const limit = jest.fn().mockReturnValue(lean([row()]));
    const sort = jest.fn().mockReturnValue({ limit });
    model.find.mockReturnValue({ sort });

    const open = await repo.listOpen('kiro', 20);

    expect(model.find).toHaveBeenCalledWith({ owner: 'kiro', status: OPEN });
    expect(sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(limit).toHaveBeenCalledWith(20);
    expect(open.map((t) => t.id)).toEqual(['t-0000000001']);
  });
});
