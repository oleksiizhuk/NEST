import {
  MAX_FAILED_ATTEMPTS,
  MAX_HISTORY,
  McpOutcome,
  McpTask,
  McpTaskEvent,
  McpTaskStatus,
  ROUND_MAX_MS,
} from '@domain/mcp-task/mcp-task.entity';
import { IMcpTaskRepository } from '@domain/mcp-task/mcp-task.repository.interface';

// Same filters as MongoMcpTaskRepository, in memory, for use-case specs.
// Keep each method in step with its Mongo filter; mongo-mcp-task.repository
// .spec pins those filters.
export class InMemoryTaskRepository implements IMcpTaskRepository {
  rows = new Map<string, McpTask>();
  now = () => new Date();

  put(
    t: McpTask,
    patch: Partial<{
      status: McpTaskStatus;
      rounds: number;
      history: McpTaskEvent[];
      inFlightSince: Date | null;
      failures: number;
    }>,
  ): McpTask {
    const next = new McpTask(
      t.id,
      t.owner,
      t.goal,
      t.checklist,
      patch.status ?? t.status,
      patch.rounds ?? t.rounds,
      (patch.history ?? t.history).slice(-MAX_HISTORY),
      t.createdAt,
      this.now(),
      'inFlightSince' in patch ? patch.inFlightSince : t.inFlightSince,
      patch.failures ?? t.failures,
    );
    this.rows.set(t.id, next);
    return next;
  }

  private own(id: string, owner: string) {
    const t = this.rows.get(id);
    return t?.owner === owner ? t : undefined;
  }

  async create(id: string, owner: string, goal: string, checklist: string[]) {
    const t = new McpTask(
      id,
      owner,
      goal,
      checklist,
      'gathering',
      0,
      [],
      this.now(),
      this.now(),
    );
    this.rows.set(id, t);
    return t;
  }

  async findById(id: string, owner: string) {
    return this.own(id, owner) ?? null;
  }

  async claimRound(id: string, owner: string, maxRounds: number, now: Date) {
    const t = this.own(id, owner);
    if (!t || !t.isOpen) return null;
    const stale = now.getTime() - ROUND_MAX_MS;
    if (t.inFlightSince && t.inFlightSince.getTime() < stale) {
      return this.put(t, { inFlightSince: now });
    }
    if (
      t.inFlightSince ||
      t.rounds >= maxRounds ||
      t.failures >= MAX_FAILED_ATTEMPTS
    ) {
      return null;
    }
    return this.put(t, { rounds: t.rounds + 1, inFlightSince: now });
  }

  async releaseRound(id: string, claimedAt: Date) {
    const t = this.rows.get(id);
    if (t && t.inFlightSince?.getTime() === claimedAt.getTime()) {
      this.put(t, {
        rounds: t.rounds - 1,
        failures: t.failures + 1,
        inFlightSince: null,
      });
    }
  }

  async recordReply(
    id: string,
    claimedAt: Date,
    kind: 'need_info' | 'answer',
    event: McpTaskEvent,
  ) {
    const t = this.rows.get(id);
    if (!t?.isOpen || t.inFlightSince?.getTime() !== claimedAt.getTime()) {
      return;
    }
    this.put(t, {
      status: McpTask.statusAfterReply(kind),
      inFlightSince: null,
      history: [...t.history, event],
    });
  }

  async report(
    id: string,
    owner: string,
    outcome: McpOutcome,
    event: McpTaskEvent,
    now = this.now(),
  ) {
    const t = this.own(id, owner);
    if (!t?.isOpen || t.roundInFlight(now)) return null;
    return this.put(t, { status: outcome, history: [...t.history, event] });
  }

  async resolveEscalated(id: string, owner: string, event: McpTaskEvent) {
    const t = this.own(id, owner);
    if (t?.status !== 'escalated') return null;
    return this.put(t, { status: 'solved', history: [...t.history, event] });
  }

  async escalate(id: string, now = this.now()) {
    const t = this.rows.get(id);
    if (t?.isOpen && !t.awaitingReport && !t.roundInFlight(now)) {
      this.put(t, { status: 'escalated' });
    }
  }

  // Test helper: one full round, claimed and answered
  async answerRound(id: string, note = 'h') {
    const t = this.rows.get(id);
    const claimed = await this.claimRound(id, t.owner, 99, this.now());
    await this.recordReply(id, claimed.inFlightSince, 'answer', {
      at: new Date(),
      kind: 'answer',
      note,
    });
  }

  async listOpen(owner: string, limit: number) {
    return [...this.rows.values()]
      .filter((t) => t.isOpen && t.owner === owner)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
}
