import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IAlertLog } from '@application/project-manager/alert-log.interface';
import { PmAlertDocument } from '@infrastructure/database/schemas/pm-alert.schema';

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoAlertLog implements IAlertLog {
  constructor(
    @InjectModel('PmAlert') private readonly model: Model<PmAlertDocument>,
  ) {}

  // The unique index makes this atomic: two runs cannot both claim a key
  async claim(chatId: number, key: string, now: Date): Promise<boolean> {
    try {
      await this.model.create({
        chatId,
        key: key.slice(0, 300),
        createdAt: now,
      });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
      throw error;
    }
  }
}
