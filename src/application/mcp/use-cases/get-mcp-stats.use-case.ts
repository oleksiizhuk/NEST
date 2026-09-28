import { Inject, Injectable } from '@nestjs/common';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  IMcpUsageRepository,
  MCP_USAGE_REPOSITORY,
} from '@domain/mcp-task/mcp-usage.repository.interface';
import { computeMcpStats, McpStats } from '@application/mcp/mcp-stats';

export const DEFAULT_STATS_DAYS = 7;
// Tasks expire 30 days after their last call, so further back is empty
export const MAX_STATS_DAYS = 30;
// More than any real month of tasks; a cap keeps one request bounded
const MAX_TASKS = 5000;

export interface McpStatsReport extends McpStats {
  budget: {
    day: string;
    // Units spent today and the daily budget (0 = no budget)
    used: number;
    limit: number;
    left: number | null;
    freeCalls: number;
  };
  // The task list hit MAX_TASKS: counts are lower bounds
  capped: boolean;
}

// GET /mcp/stats: how the bridge is used, for whoever holds MCP_TOKEN
@Injectable()
export class GetMcpStatsUseCase {
  constructor(
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
    @Inject(MCP_USAGE_REPOSITORY)
    private readonly usage: IMcpUsageRepository,
  ) {}

  async execute(request: {
    days?: number;
    limit: number;
    now?: Date;
  }): Promise<McpStatsReport> {
    const now = request.now ?? new Date();
    const days = McpStatsDays.clamp(request.days);
    const since = new Date(now.getTime() - days * 24 * 3_600_000);
    const day = now.toISOString().slice(0, 10);
    const [tasks, usage] = await Promise.all([
      this.tasks.listCreatedSince(since, MAX_TASKS),
      this.usage.usageOn(day),
    ]);
    return {
      ...computeMcpStats(tasks, now, days),
      budget: {
        day,
        used: usage.units,
        limit: request.limit,
        left: request.limit ? Math.max(0, request.limit - usage.units) : null,
        freeCalls: usage.free,
      },
      capped: tasks.length >= MAX_TASKS,
    };
  }
}

export class McpStatsDays {
  // Anything unreadable falls back to the default; the rest is kept in range
  static clamp(days?: number): number {
    if (days === undefined || !Number.isFinite(days)) return DEFAULT_STATS_DAYS;
    return Math.min(MAX_STATS_DAYS, Math.max(1, Math.floor(days)));
  }
}
