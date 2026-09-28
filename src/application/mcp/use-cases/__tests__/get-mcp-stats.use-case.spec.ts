import {
  GetMcpStatsUseCase,
  McpStatsDays,
} from '@application/mcp/use-cases/get-mcp-stats.use-case';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';

describe('GetMcpStatsUseCase', () => {
  const now = new Date('2026-09-28T12:00:00Z');

  it("counts tasks started in the period and adds today's budget", async () => {
    const tasks = new InMemoryTaskRepository();
    tasks.now = () => new Date('2026-09-27T12:00:00Z');
    await tasks.create('t-0000000001', 'kiro', 'recent', []);
    tasks.now = () => new Date('2026-09-10T12:00:00Z');
    await tasks.create('t-0000000002', 'kiro', 'too old', []);
    const usage = {
      usageOn: jest.fn().mockResolvedValue({ units: 12, free: 5 }),
    };

    const report = await new GetMcpStatsUseCase(tasks, usage).execute({
      days: 7,
      limit: 200,
      now,
    });

    expect(report.tasks.total).toBe(1);
    expect(usage.usageOn).toHaveBeenCalledWith('2026-09-28');
    expect(report.budget).toEqual({
      day: '2026-09-28',
      used: 12,
      limit: 200,
      left: 188,
      freeCalls: 5,
    });
    expect(report.capped).toBe(false);
  });

  it('shows no remainder when the budget is off', async () => {
    const usage = {
      usageOn: jest.fn().mockResolvedValue({ units: 3, free: 0 }),
    };
    const report = await new GetMcpStatsUseCase(
      new InMemoryTaskRepository(),
      usage,
    ).execute({ limit: 0, now });
    expect(report.budget.left).toBeNull();
    expect(report.period.days).toBe(7);
  });

  it('keeps days in 1..30 and falls back to 7 on nonsense', () => {
    expect(McpStatsDays.clamp(undefined)).toBe(7);
    expect(McpStatsDays.clamp(NaN)).toBe(7);
    expect(McpStatsDays.clamp(0)).toBe(1);
    expect(McpStatsDays.clamp(90)).toBe(30);
    expect(McpStatsDays.clamp(3.7)).toBe(3);
  });
});
