import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class TelegramMessageDocument extends Document {
  @Prop({ required: true })
  userId: number;

  @Prop({ type: String, default: null })
  username: string | null;

  @Prop({ type: String, default: null })
  firstName: string | null;

  @Prop({ type: String, default: null })
  lastName: string | null;

  @Prop({ required: true, index: true })
  chatId: number;

  @Prop({ required: true })
  chatType: string;

  @Prop({ type: String, default: null })
  chatTitle: string | null;

  @Prop({ type: String, default: null })
  text: string | null;

  @Prop({ type: String, default: null })
  botResponse: string | null;

  @Prop({ type: String, default: null })
  mode: string | null;

  @Prop({ type: Object, default: null })
  usage: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  feedbackToken: string | null;

  @Prop({ type: Object, default: null })
  feedback: { vote: number; userId: number; at: Date } | null;

  createdAt: Date;
}

export const TelegramMessageSchema = SchemaFactory.createForClass(
  TelegramMessageDocument,
);
TelegramMessageSchema.index({ feedbackToken: 1 }, { sparse: true });
