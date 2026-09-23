import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Proposed actions and their outcome; doubles as the audit log.
@Schema({ timestamps: true })
export class PmActionDocument extends Document {
  @Prop({ required: true, unique: true })
  actionId: string;

  @Prop({ required: true })
  kind: string;

  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  @Prop({ required: true })
  summary: string;

  @Prop({ required: true, index: true })
  chatId: number;

  @Prop({ required: true })
  requesterId: number;

  @Prop({ required: true })
  status: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ type: Number, default: null })
  confirmedBy: number | null;

  @Prop({ type: String, default: null })
  result: string | null;

  createdAt: Date;
}

export const PmActionSchema = SchemaFactory.createForClass(PmActionDocument);
