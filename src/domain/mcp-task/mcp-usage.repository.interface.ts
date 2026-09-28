export const MCP_USAGE_REPOSITORY = 'MCP_USAGE_REPOSITORY';

// What the daily limit has counted for a UTC day
export interface McpDayUsage {
  // Cost units of calls that reach the model
  units: number;
  // report_outcome / list_open_tasks calls
  free: number;
  // Units asked for past the budget and refused
  refused: number;
}

// The /mcp daily counters (keys from application/mcp/mcp-budget): the
// daily-limit guard writes them, the stats read them
export interface IMcpUsageRepository {
  // Adds to a counter atomically and returns its new value
  increment(key: string, by: number): Promise<number>;
  // Takes back what a refused call counted; best effort, never throws
  giveBack(key: string, by: number): Promise<void>;
  usageOn(day: string): Promise<McpDayUsage>;
}
