import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MCP_DAILY_BUDGET } from '@application/mcp/mcp-budget';
import { mcpDailyBudgetProvider } from '@infrastructure/http/mcp/mcp-budget.provider';

// Resolved through Nest, as the module does: the factory and its inject list
const budgetWith = async (values: Record<string, string>) => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      mcpDailyBudgetProvider,
      { provide: ConfigService, useValue: { get: (k: string) => values[k] } },
    ],
  }).compile();
  return moduleRef.get<number>(MCP_DAILY_BUDGET);
};

describe('mcpDailyBudgetProvider', () => {
  it('reads MCP_DAILY_LIMIT once: a number, the default when unset, 0 when off', async () => {
    expect(await budgetWith({ MCP_DAILY_LIMIT: '50' })).toBe(50);
    expect(await budgetWith({})).toBe(200);
    expect(await budgetWith({ MCP_DAILY_LIMIT: '0' })).toBe(0);
  });
});
