import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// A one-time admin login link; only its hash is stored
@Schema()
export class PmAdminLoginDocument extends Document {
  @Prop({ required: true, unique: true })
  tokenHash: string;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  usedAt: Date | null;
}

export const PmAdminLoginSchema =
  SchemaFactory.createForClass(PmAdminLoginDocument);
PmAdminLoginSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
