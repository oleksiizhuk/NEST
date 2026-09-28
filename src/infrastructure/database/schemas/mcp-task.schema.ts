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

  // Who called, from the X-MCP-Client header; lists are scoped to it
  @Prop({ required: true, default: 'default' })
  owner: string;

  @Prop({ required: true })
  goal: string;

  @Prop({ type: [String], default: [] })
  checklist: string[];

  @Prop({ required: true })
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

  // Set while a round runs; see McpTask.roundInFlight
  @Prop({ type: Date, default: null })
  inFlightSince: Date | null;

  // Rounds given back because the model gave no answer
  @Prop({ default: 0 })
  failures: number;

  createdAt: Date;
  updatedAt: Date;
}

export const McpTaskSchema = SchemaFactory.createForClass(McpTaskDocument);

// GET /mcp/stats: tasks started since a date
McpTaskSchema.index({ createdAt: -1 });

// list_open_tasks and the start_task reminder
McpTaskSchema.index({ owner: 1, status: 1, updatedAt: -1 });

// A task nobody touched for 30 days is gone, open or not
McpTaskSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
