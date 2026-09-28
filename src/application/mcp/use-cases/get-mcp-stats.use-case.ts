import { Inject, Injectable } from '@nestjs/common';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  IMcpUsageRepository,
  MCP_USAGE_REPOSITORY,
} from '@domain/mcp-task/mcp-usage.repository.interface';
import {
  clampStatsDays,
  computeMcpStats,
  McpStats,
  statsSince,
} from '@application/mcp/mcp-stats';
import {
  FREE_CALLS_PER_PAID,
  MCP_DAILY_BUDGET,
  usageDay,
} from '@application/mcp/mcp-budget';

// More than any real month of tasks; a cap keeps one request bounded
const MAX_TASKS = 5000;

export interface McpStatsReport extends McpStats {
  budget: {
    day: string;
    // Off (0): nothing is counted, so there is no usage to show
    limit: number;
    // Units spent today: every call let through (failed ones included,
    // they reached the model); refused calls are not in it
    used: number | null;
    // Units asked for past the budget and refused
    refused: number | null;
    left: number | null;
    freeCalls: number | null;
    freeLimit: number | null;
    // Free-tool calls refused past their cap (a looping IDE shows up here)
    refusedFreeCalls: number | null;
  };
  // Which task list hit MAX_TASKS: its counts are lower bounds
  capped: { started: boolean; open: boolean };
}

// GET /mcp/stats: how the bridge is used, for the owner (MCP_STATS_TOKEN)
@Injectable()
export class GetMcpStatsUseCase {
  constructor(
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
    @Inject(MCP_USAGE_REPOSITORY)
    private readonly usage: IMcpUsageRepository,
    @Inject(MCP_DAILY_BUDGET)
    private readonly limit: number,
  ) {}

  async execute(request: {
    days?: number;
    now?: Date;
  }): Promise<McpStatsReport> {
    const now = request.now ?? new Date();
    const days = clampStatsDays(request.days);
    const day = usageDay(now);
    const since = statsSince(now, days);
    // One more than the cap tells a cut list from an exact one
    const [started, open, usage] = await Promise.all([
      this.tasks.listCreatedSince(since, MAX_TASKS + 1),
      this.tasks.listOpenAnyOwner(MAX_TASKS + 1),
      this.usage.usageOn(day),
    ]);
    const limit = this.limit;
    return {
      ...computeMcpStats({
        started: started.slice(0, MAX_TASKS),
        open: open.slice(0, MAX_TASKS),
        now,
        since,
        days,
      }),
      budget: limit
        ? {
            day,
            limit,
            used: usage.units,
            refused: usage.refused,
            left: Math.max(0, limit - usage.units),
            freeCalls: usage.free,
            freeLimit: limit * FREE_CALLS_PER_PAID,
            refusedFreeCalls: usage.refusedFree,
          }
        : {
            day,
            limit,
            used: null,
            refused: null,
            left: null,
            freeCalls: null,
            freeLimit: null,
            refusedFreeCalls: null,
          },
      capped: {
        started: started.length > MAX_TASKS,
        open: open.length > MAX_TASKS,
      },
    };
  }
}
