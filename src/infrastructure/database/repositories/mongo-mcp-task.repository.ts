import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MAX_FAILED_ATTEMPTS,
  MAX_HISTORY,
  McpOutcome,
  McpStartedVia,
  McpTask,
  McpTaskEvent,
  OPEN_TASK_STATUSES,
  ROUND_MAX_MS,
} from '@domain/mcp-task/mcp-task.entity';
import { IMcpTaskRepository } from '@domain/mcp-task/mcp-task.repository.interface';
import { McpTaskDocument } from '@infrastructure/database/schemas/mcp-task.schema';
import { McpTaskMapper } from '@infrastructure/database/mappers/mcp-task.mapper';

const OPEN = { $in: [...OPEN_TASK_STATUSES] };
// Stats read kinds and counts, not the text: notes and checklists stay in
// the database
const STATS_FIELDS = '-checklist -history.note';
// No round running: never claimed, or claimed by a function that died
const idle = (now: Date) => ({
  $or: [
    { inFlightSince: null },
    { inFlightSince: { $lt: new Date(now.getTime() - ROUND_MAX_MS) } },
  ],
});
const push = (event: McpTaskEvent) => ({
  history: { $each: [event], $slice: -MAX_HISTORY },
});

@Injectable()
export class MongoMcpTaskRepository implements IMcpTaskRepository {
  constructor(
    @InjectModel(McpTaskDocument.name)
    private readonly tasks: Model<McpTaskDocument>,
  ) {}

  async create(
    id: string,
    owner: string,
    goal: string,
    checklist: string[],
    startedVia: McpStartedVia = 'start_task',
  ): Promise<McpTask> {
    const doc = await this.tasks.create({
      taskId: id,
      owner,
      goal,
      checklist,
      startedVia,
      status: 'gathering',
      rounds: 0,
      history: [],
      inFlightSince: null,
      failures: 0,
    });
    return McpTaskMapper.toDomain(doc);
  }

  async findById(id: string, owner: string): Promise<McpTask | null> {
    const doc = await this.tasks.findOne({ taskId: id, owner }).lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async claimRound(
    id: string,
    owner: string,
    maxRounds: number,
    now: Date,
  ): Promise<McpTask | null> {
    const stale = new Date(now.getTime() - ROUND_MAX_MS);
    const open = { taskId: id, owner, status: OPEN };
    // A round whose function died never answered: take it over as is
    const takenOver = await this.tasks
      .findOneAndUpdate(
        { ...open, inFlightSince: { $lt: stale } },
        { $set: { inFlightSince: now } },
        { new: true },
      )
      .lean();
    if (takenOver) return McpTaskMapper.toDomain(takenOver);
    const doc = await this.tasks
      .findOneAndUpdate(
        {
          ...open,
          rounds: { $lt: maxRounds },
          // Rows written before the field existed have no failures
          failures: { $not: { $gte: MAX_FAILED_ATTEMPTS } },
          inFlightSince: null,
        },
        { $inc: { rounds: 1 }, $set: { inFlightSince: now } },
        { new: true },
      )
      .lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  // After a takeover this also refunds the dead function's round: a dead
  // round plus a failed one costs no round and one failed attempt
  async releaseRound(id: string, claimedAt: Date): Promise<void> {
    await this.tasks.updateOne(
      { taskId: id, inFlightSince: claimedAt },
      {
        $inc: { rounds: -1, failures: 1 },
        $set: { inFlightSince: null },
      },
    );
  }

  async recordReply(
    id: string,
    claimedAt: Date,
    kind: 'need_info' | 'answer',
    event: McpTaskEvent,
  ): Promise<void> {
    await this.tasks.updateOne(
      { taskId: id, status: OPEN, inFlightSince: claimedAt },
      {
        $set: {
          status: McpTask.statusAfterReply(kind),
          inFlightSince: null,
        },
        $push: push(event),
      },
    );
  }

  async report(
    id: string,
    owner: string,
    outcome: McpOutcome,
    event: McpTaskEvent,
    now: Date,
  ): Promise<McpTask | null> {
    const doc = await this.tasks
      .findOneAndUpdate(
        { taskId: id, owner, status: OPEN, ...idle(now) },
        { $set: { status: outcome }, $push: push(event) },
        { new: true },
      )
      .lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async resolveEscalated(
    id: string,
    owner: string,
    event: McpTaskEvent,
  ): Promise<McpTask | null> {
    const doc = await this.tasks
      .findOneAndUpdate(
        { taskId: id, owner, status: 'escalated' },
        { $set: { status: 'solved' }, $push: push(event) },
        { new: true },
      )
      .lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async escalate(id: string, now: Date): Promise<boolean> {
    const result = await this.tasks.updateOne(
      {
        taskId: id,
        status: { $in: OPEN_TASK_STATUSES.filter((s) => s !== 'answered') },
        ...idle(now),
      },
      { $set: { status: 'escalated' } },
    );
    return result.modifiedCount > 0;
  }

  async listCreatedSince(since: Date, limit: number): Promise<McpTask[]> {
    const docs = await this.tasks
      .find({ createdAt: { $gte: since } })
      .select(STATS_FIELDS)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => McpTaskMapper.toDomain(d));
  }

  async listOpenAnyOwner(limit: number): Promise<McpTask[]> {
    const docs = await this.tasks
      .find({ status: OPEN })
      .select(STATS_FIELDS)
      .sort({ updatedAt: 1 })
      .limit(limit)
      .lean();
    return docs.map((d) => McpTaskMapper.toDomain(d));
  }

  async listOpen(owner: string, limit: number): Promise<McpTask[]> {
    const docs = await this.tasks
      .find({ owner, status: OPEN })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => McpTaskMapper.toDomain(d));
  }
}
