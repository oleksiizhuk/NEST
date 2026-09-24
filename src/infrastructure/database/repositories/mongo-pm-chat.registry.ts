import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IPmChatRegistry } from '@application/project-manager/pm-chat-registry.interface';
import { PmChatDocument } from '@infrastructure/database/schemas/pm-chat.schema';

@Injectable()
export class MongoPmChatRegistry implements IPmChatRegistry {
  constructor(
    @InjectModel('PmChat') private readonly model: Model<PmChatDocument>,
  ) {}

  async isEnabled(chatId: number): Promise<boolean> {
    return Boolean(await this.model.exists({ chatId, off: { $ne: true } }));
  }

  async isDisabled(chatId: number): Promise<boolean> {
    return Boolean(await this.model.exists({ chatId, off: true }));
  }

  async enable(chatId: number, title: string | null): Promise<void> {
    await this.model.updateOne(
      { chatId },
      { $set: { chatId, title, off: false } },
      { upsert: true },
    );
  }

  // Kept as a record, so /pm_off also beats the automatic mode
  async disable(chatId: number): Promise<void> {
    await this.model.updateOne(
      { chatId },
      { $set: { chatId, off: true } },
      { upsert: true },
    );
  }

  async clear(chatId: number): Promise<void> {
    await this.model.deleteOne({ chatId });
  }

  async digestChats(): Promise<number[]> {
    const docs = await this.model
      .find({ off: { $ne: true } })
      .select('chatId')
      .lean();
    return docs.map((d) => d.chatId);
  }
}
