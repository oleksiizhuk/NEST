import {
  McpOutcome,
  McpTask,
  McpTaskEvent,
} from '@domain/mcp-task/mcp-task.entity';

export const MCP_TASK_REPOSITORY = 'MCP_TASK_REPOSITORY';

export interface IMcpTaskRepository {
  create(id: string, goal: string, checklist: string[]): Promise<McpTask>;
  findById(id: string): Promise<McpTask | null>;
  // Atomically takes one round of advice: only an open task under
  // `maxRounds`. Null when the task is missing, closed or out of rounds.
  claimRound(id: string, maxRounds: number): Promise<McpTask | null>;
  // Records the reply of a round: need_info → gathering, answer → answered.
  // Only while the task is open.
  recordReply(id: string, event: McpTaskEvent): Promise<void>;
  // Records the caller's report on an open task; null when it is missing or
  // already closed
  report(
    id: string,
    outcome: McpOutcome,
    event: McpTaskEvent,
  ): Promise<McpTask | null>;
  // Closes an open task that ran out of rounds
  escalate(id: string): Promise<void>;
  // Open tasks, most recently touched first
  listOpen(limit: number): Promise<McpTask[]>;
}
