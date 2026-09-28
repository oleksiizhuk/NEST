import { Inject, Injectable } from '@nestjs/common';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  MAX_NOTE_CHARS,
  MAX_TASK_ROUNDS,
  McpOutcome,
  McpTask,
} from '@domain/mcp-task/mcp-task.entity';
import {
  closedText,
  reportedText,
  unknownText,
} from '@application/mcp/task-protocol';

// The caller's report on a task: solved closes it; not solved or partial
// keeps it open and points at the next round. No model call.
@Injectable()
export class ReportOutcomeUseCase {
  constructor(
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
  ) {}

  async execute(request: {
    taskId: string;
    status: McpOutcome;
    details: string;
  }): Promise<string> {
    const id = request.taskId.trim();
    const details = McpTask.clip(request.details ?? '', MAX_NOTE_CHARS);
    if (!details) {
      throw new Error('details must not be empty');
    }

    const task = await this.tasks.report(id, request.status, {
      at: new Date(),
      kind: 'report',
      note: details,
      outcome: request.status,
    });
    if (!task) {
      const existing = await this.tasks.findById(id);
      return existing ? closedText(existing) : unknownText(id);
    }
    if (task.status !== 'solved' && task.rounds >= MAX_TASK_ROUNDS) {
      await this.tasks.escalate(id);
    }
    return reportedText(task);
  }
}
