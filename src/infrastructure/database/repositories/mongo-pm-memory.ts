import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  IPmMemory,
  MemoryKind,
  MemoryRecord,
} from '@application/project-manager/memory.interface';
import { PmMemoryDocument } from '@infrastructure/database/schemas/pm-memory.schema';

// Short ids people can type: /forget M7K2Q
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newMemoryId = (): string =>
  'M' +
  Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');

const toRecord = (d: PmMemoryDocument): MemoryRecord => ({
  id: d.memoryId,
  kind: d.kind as MemoryKind,
  text: d.text,
  dueAt: d.dueAt ? new Date(d.dueAt) : null,
  createdAt: new Date(d.createdAt),
  expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
  author: d.author,
});

@Injectable()
export class MongoPmMemory implements IPmMemory {
  constructor(
    @InjectModel('PmMemory') private readonly model: Model<PmMemoryDocument>,
  ) {}

  async add(
    record: Omit<MemoryRecord, 'id' | 'createdAt'>,
  ): Promise<MemoryRecord> {
    const doc = await this.model.create({ ...record, memoryId: newMemoryId() });
    return toRecord(doc);
  }

  async active(now: Date): Promise<MemoryRecord[]> {
    // The TTL sweep runs about once a minute; filter as well
    const docs = await this.model
      .find({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] })
      .sort({ createdAt: 1 })
      .limit(300)
      .lean();
    return docs.map((d) => toRecord(d as unknown as PmMemoryDocument));
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.model.deleteOne({ memoryId: id.toUpperCase() });
    return result.deletedCount > 0;
  }
}
