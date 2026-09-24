import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IIndexJob,
  IndexDoc,
  IndexHit,
  IndexJobState,
  IndexSource,
  IProjectIndex,
} from '@application/project-manager/project-index.interface';
import {
  PmIndexDocument,
  PmIndexJobDocument,
} from '@infrastructure/database/schemas/pm-index.schema';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ±150 characters around the first query word found, else the start
export const snippetOf = (text: string, query: string): string => {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const lower = text.toLowerCase();
  const at = words
    .map((w) => lower.indexOf(w))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const start = at === undefined ? 0 : Math.max(0, at - 150);
  const piece = text
    .slice(start, start + 300)
    .replace(/\s+/g, ' ')
    .trim();
  return `${start > 0 ? '…' : ''}${piece}${
    start + 300 < text.length ? '…' : ''
  }`;
};

@Injectable()
export class MongoProjectIndex implements IProjectIndex {
  constructor(
    @InjectModel('PmIndex') private readonly model: Model<PmIndexDocument>,
  ) {}

  async upsert(docs: IndexDoc[], runId: string): Promise<void> {
    await this.model.bulkWrite(
      docs.map((d) => ({
        updateOne: {
          filter: { source: d.source, key: d.key },
          update: { $set: { ...d, runId } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async search(
    query: string,
    limit: number,
    source?: IndexSource,
  ): Promise<IndexHit[]> {
    const q = query.trim().slice(0, 200);
    if (!q) return [];
    const filter = source ? { source } : {};
    let docs = await this.model
      .find(
        { ...filter, $text: { $search: q } },
        { score: { $meta: 'textScore' } },
      )
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean();
    // Word matching has no stemming; fall back to a substring on titles
    if (!docs.length) {
      docs = await this.model
        .find({ ...filter, title: { $regex: escape(q), $options: 'i' } })
        .limit(limit)
        .lean();
    }
    return docs.map((d) => ({
      source: d.source as IndexSource,
      key: d.key,
      title: d.title,
      url: d.url ?? null,
      meta: d.meta ?? '',
      snippet: snippetOf(d.text ?? '', q),
      updatedAt: d.updatedAt ? new Date(d.updatedAt) : null,
    }));
  }

  async get(source: IndexSource, key: string): Promise<IndexDoc | null> {
    const d = await this.model.findOne({ source, key }).lean();
    return d
      ? {
          source: d.source as IndexSource,
          key: d.key,
          title: d.title,
          url: d.url ?? null,
          meta: d.meta ?? '',
          text: d.text ?? '',
          updatedAt: d.updatedAt ? new Date(d.updatedAt) : null,
        }
      : null;
  }

  async counts(): Promise<Partial<Record<IndexSource, number>>> {
    const rows = await this.model.aggregate<{ _id: IndexSource; n: number }>([
      { $group: { _id: '$source', n: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }

  async removeStale(source: IndexSource, runId: string): Promise<number> {
    const r = await this.model.deleteMany({ source, runId: { $ne: runId } });
    return r.deletedCount ?? 0;
  }
}

@Injectable()
export class MongoIndexJob implements IIndexJob {
  constructor(
    @InjectModel('PmIndexJob')
    private readonly model: Model<PmIndexJobDocument>,
  ) {}

  async get(): Promise<IndexJobState | null> {
    const d = await this.model.findOne({ key: 'main' }).lean();
    if (!d) return null;
    const s = d.state as unknown as IndexJobState;
    return {
      ...s,
      startedAt: new Date(s.startedAt),
      finishedAt: s.finishedAt ? new Date(s.finishedAt) : null,
    };
  }

  async save(state: IndexJobState): Promise<void> {
    await this.model.updateOne(
      { key: 'main' },
      { $set: { key: 'main', state } },
      { upsert: true },
    );
  }
}
