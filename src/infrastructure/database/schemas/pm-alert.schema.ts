import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PmAlertDocument extends Document {
  @Prop({ required: true })
  chatId: number;

  @Prop({ required: true })
  key: string;

  createdAt: Date;
}

export const PmAlertSchema = SchemaFactory.createForClass(PmAlertDocument);
PmAlertSchema.index({ chatId: 1, key: 1 }, { unique: true });
// After a month the same event may be reported again
PmAlertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
