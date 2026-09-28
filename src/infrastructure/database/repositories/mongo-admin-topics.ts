import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import {
  AdminTopic,
  IAdminTopics,
  TopicMessage,
  TopicSummary,
} from '@application/project-manager/admin-topics.interface';
import { PmAdminTopicDocument } from '@infrastructure/database/schemas/pm-admin-topic.schema';
import { PmAdminTopicDayDocument } from '@infrastructure/database/schemas/pm-admin-topic-day.schema';

// Newest topics a person sees in the list
const LIST_LIMIT = 50;

type Lean = {
  _id: unknown;
  userId: number;
  title: string;
  context: string | null;
  messages: Array<{ role: string; text: string; at: Date; choices?: string[] }>;
  createdAt: Date;
  updatedAt: Date;
};

const toTopic = (doc: Lean): AdminTopic => ({
  id: String(doc._id),
  userId: doc.userId,
  title: doc.title,
  context: doc.context ?? null,
  messages: (doc.messages ?? []).map((m) => ({
    role: m.role === 'user' ? 'user' : 'bot',
    text: m.text,
    at: new Date(m.at),
    ...(m.choices?.length ? { choices: m.choices } : {}),
  })),
  createdAt: new Date(doc.createdAt),
  updatedAt: new Date(doc.updatedAt),
});

@Injectable()
export class MongoAdminTopics implements IAdminTopics {
  constructor(
    @InjectModel('PmAdminTopic')
    private readonly model: Model<PmAdminTopicDocument>,
    @InjectModel('PmAdminTopicDay')
    private readonly days: Model<PmAdminTopicDayDocument>,
  ) {}

  // Increment only below the limit; at the limit the filter misses and the
  // upsert hits the unique day index, which means "full"
  async reserve(day: string, limit: number, now: Date): Promise<boolean> {
    try {
      const doc = await this.days.findOneAndUpdate(
        { day, n: { $lt: limit } },
        { $inc: { n: 1 }, $setOnInsert: { at: now } },
        { upsert: true, new: true },
      );
      return Boolean(doc);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  async used(day: string): Promise<number> {
    const doc = await this.days.findOne({ day }).lean();
    return doc?.n ?? 0;
  }

  async list(userId: number): Promise<TopicSummary[]> {
    const docs = await this.model.aggregate<{
      _id: unknown;
      title: string;
      count: number;
      updatedAt: Date;
    }>([
      { $match: { userId } },
      { $sort: { updatedAt: -1 } },
      { $limit: LIST_LIMIT },
      {
        $project: {
          title: 1,
          updatedAt: 1,
          count: { $size: { $ifNull: ['$messages', []] } },
        },
      },
    ]);
    return docs.map((d) => ({
      id: String(d._id),
      title: d.title,
      count: d.count,
      updatedAt: new Date(d.updatedAt),
    }));
  }

  async get(id: string, userId: number): Promise<AdminTopic | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model.findOne({ _id: id, userId }).lean<Lean>();
    return doc ? toTopic(doc) : null;
  }

  async create(
    topic: Pick<AdminTopic, 'userId' | 'title' | 'context'>,
    now: Date,
  ): Promise<AdminTopic> {
    const doc = await this.model.create({
      ...topic,
      messages: [],
      busyUntil: null,
      createdAt: now,
      updatedAt: now,
    });
    return toTopic(doc.toObject() as Lean);
  }

  async claim(
    id: string,
    userId: number,
    until: Date,
  ): Promise<AdminTopic | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findOneAndUpdate(
        {
          _id: id,
          userId,
          $or: [{ busyUntil: null }, { busyUntil: { $lt: new Date() } }],
        },
        { $set: { busyUntil: until } },
        { new: true },
      )
      .lean<Lean>();
    return doc ? toTopic(doc) : null;
  }

  async append(
    id: string,
    userId: number,
    messages: TopicMessage[],
    now: Date,
    title?: string,
  ): Promise<AdminTopic | null> {
    if (!isValidObjectId(id)) return null;
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, userId },
        {
          $push: { messages: { $each: messages } },
          $set: {
            busyUntil: null,
            updatedAt: now,
            ...(title ? { title } : {}),
          },
        },
        { new: true },
      )
      .lean<Lean>();
    return doc ? toTopic(doc) : null;
  }

  async release(id: string, userId: number): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.model.updateOne(
      { _id: id, userId },
      { $set: { busyUntil: null } },
    );
  }

  async remove(id: string, userId: number): Promise<void> {
    if (!isValidObjectId(id)) return;
    await this.model.deleteOne({ _id: id, userId });
  }
}
