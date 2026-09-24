import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class PmChatDocument extends Document {
  @Prop({ required: true, unique: true })
  chatId: number;

  @Prop({ type: String, default: null })
  title: string | null;

  // Explicitly switched off; missing or false = on
  @Prop({ type: Boolean, default: false })
  off: boolean;
}

export const PmChatSchema = SchemaFactory.createForClass(PmChatDocument);
