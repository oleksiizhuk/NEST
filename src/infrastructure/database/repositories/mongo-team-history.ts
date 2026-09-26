import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DayLoad,
  ITeamHistory,
} from '@application/project-manager/team-history';
import { PmTeamDayDocument } from '@infrastructure/database/schemas/pm-team-day.schema';

@Injectable()
export class MongoTeamHistory implements ITeamHistory {
  constructor(
    @InjectModel('PmTeamDay')
    private readonly model: Model<PmTeamDayDocument>,
  ) {}

  async since(day: string): Promise<DayLoad[]> {
    const docs = await this.model
      .find({ day: { $gte: day } })
      .sort({ day: 1 })
      .lean();
    return docs.map((d) => ({
      day: d.day,
      people: Object.fromEntries(
        (d.people ?? []).map((p) => [
          p.name,
          { inProgress: p.inProgress, queue: p.queue, closed14: p.closed14 },
        ]),
      ),
    }));
  }

  async save(load: DayLoad): Promise<void> {
    await this.model.updateOne(
      { day: load.day },
      {
        $set: {
          people: Object.entries(load.people).map(([name, p]) => ({
            name,
            ...p,
          })),
          at: new Date(`${load.day}T00:00:00Z`),
        },
      },
      { upsert: true },
    );
  }
}
