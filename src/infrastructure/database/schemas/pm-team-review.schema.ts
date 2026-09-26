import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class PmTeamReviewDocument extends Document {
  @Prop({ required: true })
  text: string;

  @Prop({ required: true })
  at: Date;

  // meeting / standup / retro / oneonone:<name>; missing on old notes
  @Prop({ type: String, default: 'meeting' })
  kind: string;
}

export const PmTeamReviewSchema =
  SchemaFactory.createForClass(PmTeamReviewDocument);
PmTeamReviewSchema.index({ kind: 1, at: -1 });
PmTeamReviewSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 86_400 });
