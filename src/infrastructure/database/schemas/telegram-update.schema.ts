import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// One row per Telegram update_id we started handling, so a webhook retry
// (Telegram resends when a slow reply outlives its wait) is not answered
// and billed twice.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class TelegramUpdateDocument extends Document {
  @Prop({ required: true, unique: true })
  updateId: number;

  createdAt: Date;
}

export const TelegramUpdateSchema = SchemaFactory.createForClass(
  TelegramUpdateDocument,
);
TelegramUpdateSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 86_400 },
);
