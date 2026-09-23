import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GoldenCase,
  GoldenInput,
  GoldenResult,
  IGoldenStore,
} from '@application/project-manager/golden.interface';
import { PmGoldenDocument } from '@infrastructure/database/schemas/pm-golden.schema';

@Injectable()
export class MongoGoldenStore implements IGoldenStore {
  constructor(
    @InjectModel('PmGolden') private readonly model: Model<PmGoldenDocument>,
  ) {}

  async all(): Promise<GoldenCase[]> {
    const docs = await this.model.find().sort({ caseId: 1 }).lean();
    return docs.map((d) => ({
      id: d.caseId,
      question: d.question,
      mustContain: d.mustContain ?? [],
      mustNotContain: d.mustNotContain ?? [],
      maxSeconds: d.maxSeconds,
      last: d.last ? { ...d.last, at: new Date(d.last.at) } : null,
    }));
  }

  // Keeps the last result of cases whose question did not change
  async replaceAll(cases: GoldenInput[]): Promise<void> {
    const ids = cases.map((c) => c.id);
    await this.model.deleteMany({ caseId: { $nin: ids } });
    for (const c of cases) {
      const existing = await this.model.findOne({ caseId: c.id }).lean();
      await this.model.updateOne(
        { caseId: c.id },
        {
          $set: {
            question: c.question,
            mustContain: c.mustContain,
            mustNotContain: c.mustNotContain,
            maxSeconds: c.maxSeconds,
            ...(existing && existing.question !== c.question
              ? { last: null }
              : {}),
          },
        },
        { upsert: true },
      );
    }
  }

  async saveResult(id: string, result: GoldenResult): Promise<void> {
    await this.model.updateOne({ caseId: id }, { $set: { last: result } });
  }
}
