import {
  MAX_HISTORY,
  McpOutcome,
  McpTask,
  McpTaskEvent,
  McpTaskStatus,
  ROUND_MAX_MS,
} from '@domain/mcp-task/mcp-task.entity';
import { IMcpTaskRepository } from '@domain/mcp-task/mcp-task.repository.interface';

// Same filters as MongoMcpTaskRepository, in memory, for use-case specs
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
      updatedAt: Date;
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
      patch.updatedAt ?? this.now(),
      'inFlightSince' in patch ? patch.inFlightSince : t.inFlightSince,
    );
    this.rows.set(t.id, next);
    return next;
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

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }

  async claimRound(id: string, maxRounds: number, now: Date) {
    const t = this.rows.get(id);
    const busy =
      t?.inFlightSince &&
      t.inFlightSince.getTime() >= now.getTime() - ROUND_MAX_MS;
    if (!t || !t.isOpen || t.rounds >= maxRounds || busy) return null;
    return this.put(t, { rounds: t.rounds + 1, inFlightSince: now });
  }

  async releaseRound(id: string) {
    const t = this.rows.get(id);
    if (t && t.rounds > 0 && t.inFlightSince) {
      this.put(t, { rounds: t.rounds - 1, inFlightSince: null });
    }
  }

  async recordReply(
    id: string,
    kind: 'need_info' | 'answer',
    event: McpTaskEvent,
  ) {
    const t = this.rows.get(id);
    if (!t || !t.isOpen) return;
    this.put(t, {
      status: McpTask.statusAfterReply(kind),
      inFlightSince: null,
      history: [...t.history, event],
    });
  }

  async report(id: string, outcome: McpOutcome, event: McpTaskEvent) {
    const t = this.rows.get(id);
    if (!t || !t.isOpen) return null;
    return this.put(t, { status: outcome, history: [...t.history, event] });
  }

  async resolveEscalated(id: string, event: McpTaskEvent) {
    const t = this.rows.get(id);
    if (t?.status !== 'escalated') return null;
    return this.put(t, { status: 'solved', history: [...t.history, event] });
  }

  async escalate(id: string) {
    const t = this.rows.get(id);
    if (t?.isOpen) this.put(t, { status: 'escalated' });
  }

  async listOpen(owner: string, limit: number) {
    return [...this.rows.values()]
      .filter((t) => t.isOpen && t.owner === owner)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
}
