import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// One row per UTC day, holding how many /mcp calls that day has taken.
// Lives in Mongo because a serverless function keeps no state between
// invocations, so an in-memory counter could not enforce a real cap.
@Schema({ versionKey: false, timestamps: true })
export class McpUsageDocument extends Document {
  @Prop({ required: true, unique: true, index: true })
  day: string; // YYYY-MM-DD (UTC)

  @Prop({ required: true, default: 0 })
  count: number;
}

export const McpUsageSchema = SchemaFactory.createForClass(McpUsageDocument);

// Only today's row is ever read or written, so expire old daily rows instead
// of letting the collection grow forever. 90 days keeps a usable history.
McpUsageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
