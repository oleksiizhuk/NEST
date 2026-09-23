import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Failed password logins in the current window; one document per key
@Schema()
export class PmAdminAttemptDocument extends Document {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true, default: 0 })
  failures: number;

  @Prop({ required: true })
  windowStart: Date;

  // Mongo drops the counter after the window
  @Prop({ required: true })
  expiresAt: Date;
}

export const PmAdminAttemptSchema = SchemaFactory.createForClass(
  PmAdminAttemptDocument,
);
PmAdminAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
