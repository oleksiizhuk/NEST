import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IPmSettingsStore,
  PmSettings,
} from '@application/project-manager/settings.interface';
import { PmSettingsDocument } from '@infrastructure/database/schemas/pm-settings.schema';

const KEY = 'main';

@Injectable()
export class MongoPmSettings implements IPmSettingsStore {
  constructor(
    @InjectModel('PmSettings')
    private readonly model: Model<PmSettingsDocument>,
  ) {}

  async get(): Promise<{ values: PmSettings; updatedAt: Date | null }> {
    const doc = await this.model.findOne({ key: KEY }).lean();
    return {
      values: (doc?.values ?? {}) as PmSettings,
      updatedAt: doc?.updatedAt ? new Date(doc.updatedAt) : null,
    };
  }

  // Merges: fields not in `values` keep their stored override
  async save(values: PmSettings, by: number): Promise<void> {
    const set: Record<string, unknown> = { updatedBy: by };
    for (const [k, v] of Object.entries(values)) set[`values.${k}`] = v;
    await this.model.updateOne({ key: KEY }, { $set: set }, { upsert: true });
  }

  async sessionEpoch(): Promise<number> {
    const doc = await this.model
      .findOne({ key: KEY }, { sessionEpoch: 1 })
      .lean();
    return doc?.sessionEpoch ?? 0;
  }

  async bumpSessionEpoch(): Promise<number> {
    const doc = await this.model
      .findOneAndUpdate(
        { key: KEY },
        { $inc: { sessionEpoch: 1 } },
        { upsert: true, new: true },
      )
      .lean();
    return doc?.sessionEpoch ?? 1;
  }
}
