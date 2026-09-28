import { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MCP_DAILY_BUDGET, mcpDailyLimit } from '@application/mcp/mcp-budget';

// MCP_DAILY_LIMIT read once at startup, for the daily-limit guard and the
// stats alike (env changes need a redeploy anyway)
export const mcpDailyBudgetProvider: FactoryProvider<number> = {
  provide: MCP_DAILY_BUDGET,
  useFactory: (config: ConfigService) =>
    mcpDailyLimit(config.get<string>('MCP_DAILY_LIMIT')),
  inject: [ConfigService],
};
