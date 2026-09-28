// The /mcp daily budget: how MCP_DAILY_LIMIT is read and where the counters
// live. The daily-limit guard writes the counters and the stats read them,
// so both take the keys from here.

// The budget in units, read once from MCP_DAILY_LIMIT at startup; 0 = off
export const MCP_DAILY_BUDGET = 'MCP_DAILY_BUDGET';

// Units per UTC day when MCP_DAILY_LIMIT is not set
export const DEFAULT_DAILY_LIMIT = 200;
// report_outcome / list_open_tasks per unit of budget
export const FREE_CALLS_PER_PAID = 10;

// MCP_DAILY_LIMIT as a budget in units. Unset or unreadable = the default:
// per-task caps guide the protocol but do not bound spend (a caller can open
// new tasks), so the day needs one. Exactly 0 = off.
export function mcpDailyLimit(value?: string): number {
  const n = Number(value);
  if (value === undefined || value.trim() === '' || !Number.isFinite(n)) {
    return DEFAULT_DAILY_LIMIT;
  }
  if (n === 0) return 0;
  // A fraction or a negative number is a typo, not a request to switch
  // the cap off
  return n < 0 ? DEFAULT_DAILY_LIMIT : Math.max(1, Math.floor(n));
}

// YYYY-MM-DD in UTC: one counter per day
export const usageDay = (now: Date) => now.toISOString().slice(0, 10);

// The counter row for a day: paid units, calls to the free tools, or units
// asked for past the budget and refused (they spend nothing)
export const usageKey = (day: string, kind: 'paid' | 'free' | 'refused') =>
  kind === 'paid' ? day : `${day}:${kind}`;
