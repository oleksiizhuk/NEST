import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Questions asked from the admin page per UTC day. Kept apart from the
// topics, so deleting a topic does not give its questions back.
@Schema()
export class PmAdminTopicDayDocument extends Document {
  // YYYY-MM-DD
  @Prop({ required: true })
  day: string;

  @Prop({ required: true, default: 0 })
  n: number;

  @Prop({ required: true })
  at: Date;
}

export const PmAdminTopicDaySchema = SchemaFactory.createForClass(
  PmAdminTopicDayDocument,
);
PmAdminTopicDaySchema.index({ day: 1 }, { unique: true });
PmAdminTopicDaySchema.index({ at: 1 }, { expireAfterSeconds: 7 * 86_400 });
