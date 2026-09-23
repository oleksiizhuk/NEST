import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class PmGoldenDocument extends Document {
  @Prop({ required: true, unique: true })
  caseId: string;

  @Prop({ required: true })
  question: string;

  @Prop({ type: [String], default: [] })
  mustContain: string[];

  @Prop({ type: [String], default: [] })
  mustNotContain: string[];

  @Prop({ required: true })
  maxSeconds: number;

  @Prop({ type: Object, default: null })
  last: {
    at: Date;
    pass: boolean;
    seconds: number;
    failures: string[];
    answer: string;
  } | null;
}

export const PmGoldenSchema = SchemaFactory.createForClass(PmGoldenDocument);
