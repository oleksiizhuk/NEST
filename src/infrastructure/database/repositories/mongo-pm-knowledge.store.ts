import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IKnowledgeStore,
  KnowledgeDoc,
} from '@application/project-manager/knowledge.interface';
import { PmKnowledgeDocument } from '@infrastructure/database/schemas/pm-knowledge.schema';

@Injectable()
export class MongoPmKnowledgeStore implements IKnowledgeStore {
  constructor(
    @InjectModel('PmKnowledge')
    private readonly model: Model<PmKnowledgeDocument>,
  ) {}

  async all(): Promise<KnowledgeDoc[]> {
    // Sorted by key so the rendered prompt is byte-stable
    const docs = await this.model.find().sort({ key: 1 }).lean();
    return docs.map((d) => ({
      key: d.key,
      text: d.text,
      updatedAt: new Date(d.updatedAt),
    }));
  }

  async upsert(key: string, text: string): Promise<void> {
    await this.model.updateOne(
      { key },
      { $set: { key, text } },
      { upsert: true },
    );
  }

  async remove(key: string): Promise<void> {
    await this.model.deleteOne({ key });
  }
}
