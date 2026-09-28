import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MAX_HISTORY,
  McpOutcome,
  McpTask,
  McpTaskEvent,
  OPEN_TASK_STATUSES,
} from '@domain/mcp-task/mcp-task.entity';
import { IMcpTaskRepository } from '@domain/mcp-task/mcp-task.repository.interface';
import { McpTaskDocument } from '@infrastructure/database/schemas/mcp-task.schema';
import { McpTaskMapper } from '@infrastructure/database/mappers/mcp-task.mapper';

const OPEN = { $in: [...OPEN_TASK_STATUSES] };

@Injectable()
export class MongoMcpTaskRepository implements IMcpTaskRepository {
  constructor(
    @InjectModel(McpTaskDocument.name)
    private readonly tasks: Model<McpTaskDocument>,
  ) {}

  async create(
    id: string,
    goal: string,
    checklist: string[],
  ): Promise<McpTask> {
    const doc = await this.tasks.create({
      taskId: id,
      goal,
      checklist,
      status: 'gathering',
      rounds: 0,
      history: [],
    });
    return McpTaskMapper.toDomain(doc);
  }

  async findById(id: string): Promise<McpTask | null> {
    const doc = await this.tasks.findOne({ taskId: id }).lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async claimRound(id: string, maxRounds: number): Promise<McpTask | null> {
    const doc = await this.tasks
      .findOneAndUpdate(
        { taskId: id, status: OPEN, rounds: { $lt: maxRounds } },
        { $inc: { rounds: 1 } },
        { new: true },
      )
      .lean();
    return doc ? McpTaskMapper.toDomain(doc) : null;
  }

  async recordReply(id: string, event: McpTaskEvent): Promise<void> {
    await this.tasks.updateOne(
      { taskId: id, status: OPEN },
      {
        $set: {
          status: event.kind === 'need_info' ? 'gathering' : 'answered',
        },
        $push: { history: { $each: [event], $slice: -MAX_HISTORY } },
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
        {
          $set: { status: outcome },
          $push: { history: { $each: [event], $slice: -MAX_HISTORY } },
        },
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

  async listOpen(limit: number): Promise<McpTask[]> {
    const docs = await this.tasks
      .find({ status: OPEN })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => McpTaskMapper.toDomain(d));
  }
}
