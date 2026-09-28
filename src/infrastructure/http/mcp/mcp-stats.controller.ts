import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  GetMcpStatsUseCase,
  McpStatsReport,
} from '@application/mcp/use-cases/get-mcp-stats.use-case';
import { McpStatsTokenGuard } from '@infrastructure/http/mcp/guards/mcp-token.guard';

// How the bridge is used: tasks and outcomes, whether IDEs gather first and
// report back (per client), what hangs, today's budget. For the owner only
// (MCP_STATS_TOKEN); no model call. ?days=1..30 (default 7).
@ApiExcludeController()
@Controller('mcp/stats')
@UseGuards(McpStatsTokenGuard)
export class McpStatsController {
  constructor(private readonly getStats: GetMcpStatsUseCase) {}

  @Get()
  stats(@Query('days') days?: string): Promise<McpStatsReport> {
    // Absent, empty or blank means the default, not zero days
    return this.getStats.execute({
      days: typeof days === 'string' && days.trim() ? Number(days) : undefined,
    });
  }
}
