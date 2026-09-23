import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// One document: the owner's overrides of the env config
@Schema({ timestamps: true })
export class PmSettingsDocument extends Document {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ type: Object, default: {} })
  values: Record<string, unknown>;

  @Prop({ type: Number, default: null })
  updatedBy: number | null;

  updatedAt: Date;
}

export const PmSettingsSchema =
  SchemaFactory.createForClass(PmSettingsDocument);
