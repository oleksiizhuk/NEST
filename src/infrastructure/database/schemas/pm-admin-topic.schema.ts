import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class PmTopicMessage {
  @Prop({ required: true })
  role: string;

  @Prop({ required: true })
  text: string;

  @Prop({ required: true })
  at: Date;

  @Prop({ type: [String], default: undefined })
  choices?: string[];
}

const PmTopicMessageSchema = SchemaFactory.createForClass(PmTopicMessage);

@Schema()
export class PmAdminTopicDocument extends Document {
  // Telegram user id of the admin who owns the topic
  @Prop({ required: true })
  userId: number;

  @Prop({ required: true })
  title: string;

  @Prop({ type: String, default: null })
  context: string | null;

  @Prop({ type: [PmTopicMessageSchema], default: [] })
  messages: PmTopicMessage[];

  // An answer is running until then
  @Prop({ type: Date, default: null })
  busyUntil: Date | null;

  @Prop({ required: true })
  createdAt: Date;

  @Prop({ required: true })
  updatedAt: Date;
}

export const PmAdminTopicSchema =
  SchemaFactory.createForClass(PmAdminTopicDocument);
PmAdminTopicSchema.index({ userId: 1, updatedAt: -1 });
// Topics nobody touched for 90 days go away
PmAdminTopicSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 86_400 });
