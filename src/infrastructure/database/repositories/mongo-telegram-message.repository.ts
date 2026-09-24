import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AnswerRecord,
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

  async setFeedback(
    token: string,
    chatId: number,
    vote: 1 | -1,
    userId: number,
  ): Promise<boolean> {
    const result = await this.telegramMessageModel.updateOne(
      // The first vote sticks: a late press (buttons not yet removed) must
      // not turn a 👎 into a 👍
      { feedbackToken: token, chatId, feedback: null },
      { $set: { feedback: { vote, userId, at: new Date() } } },
    );
    return result.matchedCount > 0;
  }

  async recentGroups(
    limit: number,
  ): Promise<Array<{ chatId: number; title: string | null; lastAt: Date }>> {
    const rows = await this.telegramMessageModel.aggregate<{
      _id: number;
      title: string | null;
      lastAt: Date;
    }>([
      { $match: { chatType: { $in: ['group', 'supergroup'] } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$chatId',
          title: { $first: '$chatTitle' },
          lastAt: { $first: '$createdAt' },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: limit },
    ]);
    return rows.map((r) => ({
      chatId: r._id,
      title: r.title ?? null,
      lastAt: new Date(r.lastAt),
    }));
  }

  async recentAnswers(limit: number): Promise<AnswerRecord[]> {
    const docs = await this.telegramMessageModel
      .find(
        { mode: 'pm', usage: { $ne: null } },
        { createdAt: 1, chatId: 1, text: 1, usage: 1, feedback: 1 },
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => ({
      createdAt: new Date(d.createdAt),
      chatId: d.chatId,
      question: d.text ?? null,
      usage: (d.usage as Record<string, unknown>) ?? null,
      vote: d.feedback?.vote ?? null,
    }));
  }
}
