import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class SnapshotSectionDocument {
  source: string;
  ok: boolean;
  fetchedAt: Date;
  text: string;
  error: string | null;
  metrics?: Record<string, number>;
  signals?: Array<{ rule: string; subject: string; text: string }>;
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class ProjectSnapshotDocument extends Document {
  @Prop({ type: Array, required: true })
  sections: SnapshotSectionDocument[];

  @Prop({ type: String, default: null })
  digest: string | null;

  createdAt: Date;
}

export const ProjectSnapshotSchema = SchemaFactory.createForClass(
  ProjectSnapshotDocument,
);
ProjectSnapshotSchema.index({ createdAt: -1 });
// Three weeks of daily snapshots is plenty of history
ProjectSnapshotSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 21 * 86_400 },
);
