import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// One UTC day of per-person open work (a list: names may hold dots)
@Schema()
export class PmTeamDayDocument extends Document {
  @Prop({ required: true, unique: true })
  day: string;

  @Prop({ type: Array, default: [] })
  people: Array<{
    name: string;
    inProgress: number;
    queue: number;
    closed14: number;
  }>;

  @Prop({ required: true })
  at: Date;
}

export const PmTeamDaySchema = SchemaFactory.createForClass(PmTeamDayDocument);
PmTeamDaySchema.index({ at: 1 }, { expireAfterSeconds: 200 * 86_400 });
