import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class PmTeamReviewDocument extends Document {
  @Prop({ required: true })
  text: string;

  @Prop({ required: true })
  at: Date;
}

export const PmTeamReviewSchema =
  SchemaFactory.createForClass(PmTeamReviewDocument);
PmTeamReviewSchema.index({ at: -1 });
PmTeamReviewSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 86_400 });
