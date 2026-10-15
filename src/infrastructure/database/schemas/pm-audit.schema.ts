import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class PmAuditCheck {
  @Prop({ required: true })
  userId: number;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  at: Date;
}

const PmAuditCheckSchema = SchemaFactory.createForClass(PmAuditCheck);

@Schema({ _id: false })
export class PmAuditItem {
  @Prop({ required: true })
  kind: string;

  @Prop({ required: true })
  index: number;

  @Prop({ required: true })
  title: string;

  @Prop({ default: '' })
  detail: string;

  @Prop({ type: [String], default: [] })
  areas: string[];

  @Prop({ default: false })
  repeat: boolean;

  @Prop({ type: PmAuditCheckSchema, default: null })
  checkedBy: PmAuditCheck | null;
}

const PmAuditItemSchema = SchemaFactory.createForClass(PmAuditItem);

@Schema({ _id: false })
export class PmAuditPost {
  @Prop({ required: true })
  kind: string;

  @Prop({ required: true })
  chatId: number;

  @Prop({ required: true })
  messageId: number;
}

const PmAuditPostSchema = SchemaFactory.createForClass(PmAuditPost);

@Schema({ collection: 'pmaudits' })
export class PmAuditDocument extends Document {
  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  status: string;

  @Prop({ required: true })
  phase: string;

  // Phase name → raw model text; keys contain dashes, so a plain object
  @Prop({ type: Object, default: {} })
  findings: Record<string, string>;

  @Prop({ type: [PmAuditItemSchema], default: [] })
  items: PmAuditItem[];

  @Prop({ type: [PmAuditPostSchema], default: [] })
  posts: PmAuditPost[];

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ type: String, default: null })
  error: string | null;

  // 'cron' or the admin's Telegram user id
  @Prop({ type: Object, required: true })
  startedBy: string | number;

  @Prop({ required: true })
  startedAt: Date;

  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  // A step is running until then
  @Prop({ type: Date, default: null })
  stepUntil: Date | null;
}

export const PmAuditSchema = SchemaFactory.createForClass(PmAuditDocument);
PmAuditSchema.index({ runId: 1 }, { unique: true });
// At most one run in progress: a second insert fails with a duplicate key
PmAuditSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: 'running' } },
);
PmAuditSchema.index({ status: 1, startedAt: -1 });
PmAuditSchema.index({ startedAt: 1 }, { expireAfterSeconds: 120 * 86_400 });
