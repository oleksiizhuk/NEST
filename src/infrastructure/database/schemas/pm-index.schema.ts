import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class PmIndexDocument extends Document {
  @Prop({ required: true }) source: string;
  @Prop({ required: true }) key: string;
  @Prop({ required: true }) title: string;
  @Prop({ type: String, default: null }) url: string | null;
  @Prop({ default: '' }) meta: string;
  @Prop({ default: '' }) text: string;
  @Prop({ type: Date, default: null }) updatedAt: Date | null;
  @Prop({ required: true }) runId: string;
}

export const PmIndexSchema = SchemaFactory.createForClass(PmIndexDocument);
PmIndexSchema.index({ source: 1, key: 1 }, { unique: true });
// Mixed Russian/English text: no stemming, plain word matching
PmIndexSchema.index(
  { title: 'text', meta: 'text', text: 'text' },
  { weights: { title: 5, meta: 2, text: 1 }, default_language: 'none' },
);

@Schema()
export class PmIndexJobDocument extends Document {
  @Prop({ required: true, unique: true }) key: string;
  @Prop({ type: Object, required: true }) state: Record<string, unknown>;
}

export const PmIndexJobSchema =
  SchemaFactory.createForClass(PmIndexJobDocument);
