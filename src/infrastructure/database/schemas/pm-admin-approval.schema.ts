import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PmAdminApprovalDocument extends Document {
  @Prop({ required: true, unique: true })
  requestId: string;

  // pending | approved | denied | spent
  @Prop({ required: true, default: 'pending' })
  status: string;

  @Prop({ required: true })
  expiresAt: Date;

  createdAt: Date;
}

export const PmAdminApprovalSchema = SchemaFactory.createForClass(
  PmAdminApprovalDocument,
);
// Kept a while after expiry so a late tap still gets a clear answer
PmAdminApprovalSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });
