import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type {
  McpOutcome,
  McpTaskEventKind,
  McpTaskStatus,
} from '@domain/mcp-task/mcp-task.entity';

// A task an IDE assistant works through over /mcp. Holds only the goal, the
// checklist and short notes per round, never the caller's code or answers.
@Schema({ versionKey: false, timestamps: true, collection: 'mcptasks' })
export class McpTaskDocument extends Document {
  @Prop({ required: true, unique: true })
  taskId: string;

  @Prop({ required: true })
  goal: string;

  @Prop({ type: [String], default: [] })
  checklist: string[];

  @Prop({ required: true, index: true })
  status: McpTaskStatus;

  @Prop({ required: true, default: 0 })
  rounds: number;

  @Prop({
    type: [
      {
        _id: false,
        at: Date,
        kind: String,
        note: String,
        outcome: String,
      },
    ],
    default: [],
  })
  history: {
    at: Date;
    kind: McpTaskEventKind;
    note: string;
    outcome?: McpOutcome;
  }[];

  createdAt: Date;
  updatedAt: Date;
}

export const McpTaskSchema = SchemaFactory.createForClass(McpTaskDocument);

// A task nobody touched for 30 days is gone, open or not
McpTaskSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
