import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ISeenJobs } from '@application/job-watch/seen-jobs.interface';
import { JobWatchSeenDocument } from '@infrastructure/database/schemas/job-watch-seen.schema';

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoSeenJobs implements ISeenJobs {
  constructor(
    @InjectModel('JobWatchSeen')
    private readonly model: Model<JobWatchSeenDocument>,
  ) {}

  // The unique index makes this atomic: two runs cannot both claim a key
  async claim(key: string, now: Date): Promise<boolean> {
    try {
      await this.model.create({ key: key.slice(0, 300), createdAt: now });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
      throw error;
    }
  }

  async release(key: string): Promise<void> {
    await this.model.deleteOne({ key: key.slice(0, 300) });
  }
}
