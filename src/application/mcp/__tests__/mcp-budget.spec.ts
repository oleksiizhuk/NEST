import {
  DEFAULT_DAILY_LIMIT,
  mcpDailyLimit,
  usageDay,
  usageKey,
} from '@application/mcp/mcp-budget';

describe('mcp-budget', () => {
  it('reads MCP_DAILY_LIMIT: unset or junk is the default, 0 is off, typos never switch it off', () => {
    expect(mcpDailyLimit(undefined)).toBe(DEFAULT_DAILY_LIMIT);
    expect(mcpDailyLimit(' ')).toBe(DEFAULT_DAILY_LIMIT);
    expect(mcpDailyLimit('abc')).toBe(DEFAULT_DAILY_LIMIT);
    expect(mcpDailyLimit('0')).toBe(0);
    expect(mcpDailyLimit('0.5')).toBe(1);
    expect(mcpDailyLimit('-3')).toBe(DEFAULT_DAILY_LIMIT);
    expect(mcpDailyLimit('50.9')).toBe(50);
  });

  it('keys one counter per UTC day for paid units and one for free calls', () => {
    const day = usageDay(new Date('2026-09-28T23:30:00-05:00'));
    expect(day).toBe('2026-09-29');
    expect(usageKey(day, 'paid')).toBe('2026-09-29');
    expect(usageKey(day, 'free')).toBe('2026-09-29:free');
  });
});
