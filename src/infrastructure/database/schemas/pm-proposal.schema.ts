import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class PmProposalDocument extends Document {
  @Prop({ required: true, unique: true })
  proposalId: string;

  @Prop({ required: true })
  fingerprint: string;

  @Prop({ type: [String], default: [] })
  keys: string[];

  @Prop({ required: true })
  kind: string;

  @Prop({ required: true })
  blocker: string;

  @Prop({ required: true })
  step: string;

  @Prop({ type: String, default: null })
  ask: string | null;

  @Prop({ type: String, default: null })
  draft: string | null;

  @Prop({ required: true, default: 'sent' })
  status: string;

  @Prop({ required: true })
  createdAt: Date;

  @Prop({ type: Date, default: null })
  ratedAt: Date | null;
}

export const PmProposalSchema =
  SchemaFactory.createForClass(PmProposalDocument);
PmProposalSchema.index({ createdAt: -1 });
// Ratings older than this no longer steer anything
PmProposalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86_400 });
