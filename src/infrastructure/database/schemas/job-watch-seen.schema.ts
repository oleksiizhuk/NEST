import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// A posting already announced by the job watch (`<board>:<posting id>`)
@Schema({
  collection: 'jobwatchseen',
  timestamps: { createdAt: true, updatedAt: false },
})
export class JobWatchSeenDocument extends Document {
  @Prop({ required: true, unique: true })
  key: string;

  createdAt: Date;
}

export const JobWatchSeenSchema =
  SchemaFactory.createForClass(JobWatchSeenDocument);
// Postings rarely stay open this long; one that does may be announced again
JobWatchSeenSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 365 * 86_400 },
);
