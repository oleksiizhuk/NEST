import { GetMcpStatsUseCase } from '@application/mcp/use-cases/get-mcp-stats.use-case';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';
import { IMcpTaskRepository } from '@domain/mcp-task/mcp-task.repository.interface';
import { McpTask } from '@domain/mcp-task/mcp-task.entity';

describe('GetMcpStatsUseCase', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const usage = (units: number, free = 0, refused = 0, refusedFree = 0) => ({
    increment: jest.fn(),
    giveBack: jest.fn(),
    usageOn: jest.fn().mockResolvedValue({ units, free, refused, refusedFree }),
  });

  it('counts tasks started in the period, open tasks of any age, and splits spend from refusals', async () => {
    const tasks = new InMemoryTaskRepository();
    tasks.now = () => new Date('2026-09-27T12:00:00Z');
    await tasks.create('t-0000000001', 'kiro', 'recent', []);
    tasks.now = () => new Date('2026-09-10T12:00:00Z');
    await tasks.create('t-0000000002', 'kiro', 'old and still open', []);
    const counters = usage(199, 30, 4, 12);

    const report = await new GetMcpStatsUseCase(tasks, counters, 200).execute({
      days: 7,
      now,
    });

    expect(report.started.total).toBe(1);
    expect(report.open.total).toBe(2);
    expect(report.open.stuck[0].goal).toBe('old and still open');
    expect(counters.usageOn).toHaveBeenCalledWith('2026-09-28');
    expect(report.budget).toEqual({
      day: '2026-09-28',
      limit: 200,
      used: 199,
      refused: 4,
      left: 1,
      freeCalls: 30,
      freeLimit: 2000,
      refusedFreeCalls: 12,
    });
    expect(report.capped).toEqual({ started: false, open: false });
  });

  it('never shows a negative remainder while two refused calls are being given back', async () => {
    const report = await new GetMcpStatsUseCase(
      new InMemoryTaskRepository(),
      usage(203),
      200,
    ).execute({ now });
    expect(report.budget.left).toBe(0);
  });

  it('shows no usage when the budget is off: nothing is counted then', async () => {
    const report = await new GetMcpStatsUseCase(
      new InMemoryTaskRepository(),
      usage(0),
      0,
    ).execute({ now });
    expect(report.budget).toMatchObject({ limit: 0, used: null, left: null });
    expect(report.period.days).toBe(7);
  });

  it('says which list was cut, and counts only up to the cap', async () => {
    const many = Array.from(
      { length: 5001 },
      (_, i) =>
        new McpTask(`t-${i}`, 'kiro', 'g', [], 'gathering', 1, [], now, now),
    );
    const tasks = {
      listCreatedSince: jest.fn().mockResolvedValue([]),
      listOpenAnyOwner: jest.fn().mockResolvedValue(many),
    } as unknown as IMcpTaskRepository;

    const report = await new GetMcpStatsUseCase(tasks, usage(0), 200).execute({
      now,
    });

    expect(tasks.listOpenAnyOwner).toHaveBeenCalledWith(5001);
    expect(report.capped).toEqual({ started: false, open: true });
    expect(report.open.total).toBe(5000);

    const started = {
      listCreatedSince: jest.fn().mockResolvedValue(many),
      listOpenAnyOwner: jest.fn().mockResolvedValue([]),
    } as unknown as IMcpTaskRepository;
    const byStart = await new GetMcpStatsUseCase(
      started,
      usage(0),
      200,
    ).execute({ now });
    expect(started.listCreatedSince).toHaveBeenCalledWith(
      expect.any(Date),
      5001,
    );
    expect(byStart.capped).toEqual({ started: true, open: false });
    expect(byStart.started.total).toBe(5000);
  });
});
