export const MCP_USAGE_REPOSITORY = 'MCP_USAGE_REPOSITORY';

// What the daily limit has counted for a UTC day
export interface McpDayUsage {
  // Cost units of calls that reach the model
  units: number;
  // report_outcome / list_open_tasks calls
  free: number;
}

export interface IMcpUsageRepository {
  usageOn(day: string): Promise<McpDayUsage>;
}
