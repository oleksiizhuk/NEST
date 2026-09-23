import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PmMemoryDocument extends Document {
  @Prop({ required: true, unique: true })
  memoryId: string;

  @Prop({ required: true })
  kind: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: Date, default: null })
  dueAt: Date | null;

  // Mongo removes the record at this time; null = kept
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  @Prop({ required: true })
  author: string;

  createdAt: Date;
}

export const PmMemorySchema = SchemaFactory.createForClass(PmMemoryDocument);
PmMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
