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

  // Whose link it is (the owner or another admin); older links have none
  @Prop({ type: Number, default: null })
  userId: number | null;
}

export const PmAdminLoginSchema =
  SchemaFactory.createForClass(PmAdminLoginDocument);
PmAdminLoginSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
