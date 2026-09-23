import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class PmKnowledgeDocument extends Document {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  text: string;

  updatedAt: Date;
}

export const PmKnowledgeSchema =
  SchemaFactory.createForClass(PmKnowledgeDocument);
