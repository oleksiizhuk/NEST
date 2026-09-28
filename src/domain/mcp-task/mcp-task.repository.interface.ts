import {
  McpOutcome,
  McpTask,
  McpTaskEvent,
} from '@domain/mcp-task/mcp-task.entity';

export const MCP_TASK_REPOSITORY = 'MCP_TASK_REPOSITORY';

// Every lookup is by task id and owner: a client only ever sees and acts
// on its own tasks
export interface IMcpTaskRepository {
  create(
    id: string,
    owner: string,
    goal: string,
    checklist: string[],
  ): Promise<McpTask>;
  findById(id: string, owner: string): Promise<McpTask | null>;
  // Atomically takes one round: an open task under `maxRounds` and the
  // failed-attempt cap, with no round running. A round left behind by a
  // function that died is taken over without counting another one. The
  // returned task's inFlightSince is the claim that closes the round.
  claimRound(
    id: string,
    owner: string,
    maxRounds: number,
    now: Date,
  ): Promise<McpTask | null>;
  // Gives the claimed round back and counts a failed attempt
  releaseRound(id: string, claimedAt: Date): Promise<void>;
  // Records the reply of the claimed round and ends it: need_info →
  // gathering, answer → answered. Only while the task is open and the claim
  // is still this one.
  recordReply(
    id: string,
    claimedAt: Date,
    kind: 'need_info' | 'answer',
    event: McpTaskEvent,
  ): Promise<void>;
  // Records the caller's report on an open task with no round running;
  // null when it is missing, closed or busy
  report(
    id: string,
    owner: string,
    outcome: McpOutcome,
    event: McpTaskEvent,
    now: Date,
  ): Promise<McpTask | null>;
  // A late "solved" on a task closed as escalated still counts
  resolveEscalated(
    id: string,
    owner: string,
    event: McpTaskEvent,
  ): Promise<McpTask | null>;
  // Closes an open task that ran out of rounds or attempts — only while no
  // round runs and no answer waits for its report (shouldEscalate, atomic)
  escalate(id: string, now: Date): Promise<void>;
  // The owner's open tasks, most recently touched first
  listOpen(owner: string, limit: number): Promise<McpTask[]>;
}
