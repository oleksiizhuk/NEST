import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ITelegramMessageRepository,
  TelegramMessageLog,
} from '@domain/telegram/telegram-message.repository.interface';
import { TelegramMessage } from '@domain/telegram/telegram-message.entity';
import { TelegramMessageDocument } from '@infrastructure/database/schemas/telegram-message.schema';
import { TelegramMessageMapper } from '@infrastructure/database/mappers/telegram-message.mapper';

@Injectable()
export class MongoTelegramMessageRepository
  implements ITelegramMessageRepository
{
  constructor(
    @InjectModel('TelegramMessage')
    private telegramMessageModel: Model<TelegramMessageDocument>,
  ) {}

  async save(data: TelegramMessageLog): Promise<TelegramMessage> {
    const doc = new this.telegramMessageModel(data);
    await doc.save();
    return TelegramMessageMapper.toDomain(doc);
  }

  async findByChatId(
    chatId: number,
    limit: number,
  ): Promise<TelegramMessage[]> {
    const docs = await this.telegramMessageModel
      .find({ chatId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
    return docs.map(TelegramMessageMapper.toDomain);
  }
}
