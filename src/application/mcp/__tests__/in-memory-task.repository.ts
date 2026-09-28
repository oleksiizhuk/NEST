import {
  MAX_HISTORY,
  McpOutcome,
  McpTask,
  McpTaskEvent,
  McpTaskStatus,
} from '@domain/mcp-task/mcp-task.entity';
import { IMcpTaskRepository } from '@domain/mcp-task/mcp-task.repository.interface';

// Same rules as MongoMcpTaskRepository, in memory, for use-case specs
export class InMemoryTaskRepository implements IMcpTaskRepository {
  rows = new Map<string, McpTask>();
  now = () => new Date();

  private put(
    t: McpTask,
    patch: Partial<{
      status: McpTaskStatus;
      rounds: number;
      history: McpTaskEvent[];
    }>,
  ): McpTask {
    const next = new McpTask(
      t.id,
      t.goal,
      t.checklist,
      patch.status ?? t.status,
      patch.rounds ?? t.rounds,
      (patch.history ?? t.history).slice(-MAX_HISTORY),
      t.createdAt,
      this.now(),
    );
    this.rows.set(t.id, next);
    return next;
  }

  async create(id: string, goal: string, checklist: string[]) {
    const t = new McpTask(
      id,
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

  async claimRound(id: string, maxRounds: number) {
    const t = this.rows.get(id);
    if (!t || !t.isOpen || t.rounds >= maxRounds) return null;
    return this.put(t, { rounds: t.rounds + 1 });
  }

  async recordReply(id: string, event: McpTaskEvent) {
    const t = this.rows.get(id);
    if (!t || !t.isOpen) return;
    this.put(t, {
      status: event.kind === 'need_info' ? 'gathering' : 'answered',
      history: [...t.history, event],
    });
  }

  async report(id: string, outcome: McpOutcome, event: McpTaskEvent) {
    const t = this.rows.get(id);
    if (!t || !t.isOpen) return null;
    return this.put(t, { status: outcome, history: [...t.history, event] });
  }

  async escalate(id: string) {
    const t = this.rows.get(id);
    if (t?.isOpen) this.put(t, { status: 'escalated' });
  }

  async listOpen(limit: number) {
    return [...this.rows.values()]
      .filter((t) => t.isOpen)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
}
