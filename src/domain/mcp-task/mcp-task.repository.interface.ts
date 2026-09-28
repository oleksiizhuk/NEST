import {
  McpOutcome,
  McpTask,
  McpTaskEvent,
} from '@domain/mcp-task/mcp-task.entity';

export const MCP_TASK_REPOSITORY = 'MCP_TASK_REPOSITORY';

export interface IMcpTaskRepository {
  create(
    id: string,
    owner: string,
    goal: string,
    checklist: string[],
  ): Promise<McpTask>;
  findById(id: string): Promise<McpTask | null>;
  // Atomically takes one round of advice: only an open task under
  // `maxRounds` with no other round running. Null otherwise.
  claimRound(id: string, maxRounds: number, now: Date): Promise<McpTask | null>;
  // Gives a round back when the model gave no answer, so failures do not
  // use up the task
  releaseRound(id: string): Promise<void>;
  // Records the reply of a round and ends it: need_info → gathering,
  // answer → answered. Only while the task is open.
  recordReply(
    id: string,
    kind: 'need_info' | 'answer',
    event: McpTaskEvent,
  ): Promise<void>;
  // Records the caller's report on an open task; null when it is missing or
  // already closed
  report(
    id: string,
    outcome: McpOutcome,
    event: McpTaskEvent,
  ): Promise<McpTask | null>;
  // A late "solved" on a task closed as escalated still counts
  resolveEscalated(id: string, event: McpTaskEvent): Promise<McpTask | null>;
  // Closes an open task that ran out of rounds
  escalate(id: string): Promise<void>;
  // The owner's open tasks, most recently touched first
  listOpen(owner: string, limit: number): Promise<McpTask[]>;
}
