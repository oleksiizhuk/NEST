import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PmQuotaDocument extends Document {
  @Prop({ required: true })
  userId: number;

  // YYYY-MM-DD, UTC
  @Prop({ required: true })
  day: string;

  @Prop({ required: true, default: 0 })
  count: number;

  createdAt: Date;
}

export const PmQuotaSchema = SchemaFactory.createForClass(PmQuotaDocument);
PmQuotaSchema.index({ userId: 1, day: 1 }, { unique: true });
PmQuotaSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3 * 86_400 });
