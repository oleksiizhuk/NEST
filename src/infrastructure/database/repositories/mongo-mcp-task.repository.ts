import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MAX_HISTORY,
  McpOutcome,
  McpTask,
  McpTaskEvent,
  OPEN_TASK_STATUSES,
  ROUND_MAX_MS,
} from '@domain/mcp-task/mcp-task.entity';
import { IMcpTaskRepository } from '@domain/mcp-task/mcp-task.repository.interface';
import { McpTaskDocument } from '@infrastructure/database/schemas/mcp-task.schema';
import { McpTaskMapper } from '@infrastructure/database/mappers/mcp-task.mapper';

const OPEN = { $in: [...OPEN_TASK_STATUSES] };
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
  ): Promise<McpTask> {
    const doc = await this.tasks.create({
      taskId: id,
      owner,
      goal,
      checklist,
      status: 'gathering',
      rounds: 0,
      history: [],
      inFlightSince: null,
    });
    return McpTaskMapper.toDomain(doc);
  }

  async findById(id: string): Promise<McpTask | null> {
    const doc = await this.tasks.findOne({ taskId: id }).lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async claimRound(
    id: string,
    maxRounds: number,
    now: Date,
  ): Promise<McpTask | null> {
    const doc = await this.tasks
      .findOneAndUpdate(
        {
          taskId: id,
          status: OPEN,
          rounds: { $lt: maxRounds },
          // A round left behind by a function that died does not block
          $or: [
            { inFlightSince: null },
            {
              inFlightSince: {
                $lt: new Date(now.getTime() - ROUND_MAX_MS),
              },
            },
          ],
        },
        { $inc: { rounds: 1 }, $set: { inFlightSince: now } },
        { new: true },
      )
      .lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async releaseRound(id: string): Promise<void> {
    await this.tasks.updateOne(
      { taskId: id, rounds: { $gt: 0 }, inFlightSince: { $ne: null } },
      { $inc: { rounds: -1 }, $set: { inFlightSince: null } },
    );
  }

  async recordReply(
    id: string,
    kind: 'need_info' | 'answer',
    event: McpTaskEvent,
  ): Promise<void> {
    await this.tasks.updateOne(
      { taskId: id, status: OPEN },
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
    outcome: McpOutcome,
    event: McpTaskEvent,
  ): Promise<McpTask | null> {
    const doc = await this.tasks
      .findOneAndUpdate(
        { taskId: id, status: OPEN },
        { $set: { status: outcome }, $push: push(event) },
        { new: true },
      )
      .lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async resolveEscalated(
    id: string,
    event: McpTaskEvent,
  ): Promise<McpTask | null> {
    const doc = await this.tasks
      .findOneAndUpdate(
        { taskId: id, status: 'escalated' },
        { $set: { status: 'solved' }, $push: push(event) },
        { new: true },
      )
      .lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async escalate(id: string): Promise<void> {
    await this.tasks.updateOne(
      { taskId: id, status: OPEN },
      { $set: { status: 'escalated' } },
    );
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
