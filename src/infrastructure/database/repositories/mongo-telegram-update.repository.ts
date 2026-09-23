import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ITelegramUpdateRegistry } from '@application/telegram/telegram-update-registry.interface';
import { TelegramUpdateDocument } from '@infrastructure/database/schemas/telegram-update.schema';

const DUPLICATE_KEY = 11000;

@Injectable()
export class MongoTelegramUpdateRegistry implements ITelegramUpdateRegistry {
  constructor(
    @InjectModel('TelegramUpdate')
    private readonly model: Model<TelegramUpdateDocument>,
  ) {}

  async claim(updateId: number): Promise<boolean> {
    try {
      await this.model.create({ updateId });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
      // Storage trouble must not silence the bot: handle the update anyway
      return true;
    }
  }
}
