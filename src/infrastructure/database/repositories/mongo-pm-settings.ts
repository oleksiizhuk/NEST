import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IPmSettingsStore,
  PmSettings,
} from '@application/project-manager/settings.interface';
import { TeamAway } from '@application/project-manager/team';
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
    const values = { ...((doc?.values ?? {}) as Record<string, unknown>) };
    // Mongo keys cannot hold every display name, so the map is a list
    if (Array.isArray(values.githubLogins)) {
      values.githubLogins = Object.fromEntries(
        (values.githubLogins as Array<{ name: string; login: string }>).map(
          (p) => [p.name, p.login],
        ),
      );
    }
    if (Array.isArray(values.teamAway)) {
      values.teamAway = Object.fromEntries(
        (
          values.teamAway as Array<{
            name: string;
            until: string;
            note: string | null;
          }>
        ).map((p) => [p.name, { until: p.until, note: p.note ?? null }]),
      );
    }
    return {
      values: values as PmSettings,
      updatedAt: doc?.updatedAt ? new Date(doc.updatedAt) : null,
    };
  }

  // Merges: fields not in `values` keep their stored override
  async save(values: PmSettings, by: number): Promise<void> {
    const set: Record<string, unknown> = { updatedBy: by };
    for (const [k, v] of Object.entries(values)) {
      set[`values.${k}`] =
        k === 'githubLogins' && v
          ? Object.entries(v as Record<string, string>).map(
              ([name, login]) => ({
                name,
                login,
              }),
            )
          : k === 'teamAway' && v
          ? Object.entries(v as TeamAway).map(([name, a]) => ({
              name,
              until: a.until,
              note: a.note ?? null,
            }))
          : v;
    }
    await this.model.updateOne({ key: KEY }, { $set: set }, { upsert: true });
  }

  // $pull then $push: each step is atomic, so concurrent edits of other
  // people or items are never lost
  async setAway(
    name: string,
    away: { until: string; note: string | null } | null,
    by: number,
  ): Promise<void> {
    await this.model.updateOne(
      { key: KEY },
      { $pull: { 'values.teamAway': { name } }, $set: { updatedBy: by } },
      { upsert: true },
    );
    if (away)
      await this.model.updateOne(
        { key: KEY },
        { $push: { 'values.teamAway': { name, ...away } } },
      );
  }

  async hideToday(
    id: string,
    until: string,
    now: string,
    by: number,
  ): Promise<void> {
    await this.model.updateOne(
      { key: KEY },
      {
        $pull: {
          'values.todayHidden': { $or: [{ id }, { until: { $lte: now } }] },
        },
        $set: { updatedBy: by },
      },
      { upsert: true },
    );
    await this.model.updateOne(
      { key: KEY },
      {
        $push: {
          'values.todayHidden': { $each: [{ id, until }], $slice: -200 },
        },
      },
    );
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
