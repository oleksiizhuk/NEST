import { Inject, Injectable } from '@nestjs/common';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  MAX_NOTE_CHARS,
  McpOutcome,
  McpTask,
} from '@domain/mcp-task/mcp-task.entity';
import {
  closedText,
  escalatedText,
  reportedText,
  unknownText,
} from '@application/mcp/task-protocol';

// The caller's report on a task: solved closes it; not solved or partial
// keeps it open and points at the next round, or hands it to a person when
// the rounds are used up. No model call.
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
    const id = request.taskId.trim().toLowerCase();
    const details = McpTask.clean(request.details ?? '', MAX_NOTE_CHARS);
    if (!details) {
      throw new Error('details must not be empty');
    }

    const event = {
      at: new Date(),
      kind: 'report' as const,
      note: details,
      outcome: request.status,
    };
    const task = await this.tasks.report(id, request.status, event);
    if (!task) {
      const existing = await this.tasks.findById(id);
      if (!existing) return unknownText(id);
      if (existing.status === 'escalated' && request.status === 'solved') {
        const solved = await this.tasks.resolveEscalated(id, event);
        if (solved) return reportedText(solved, false);
      }
      return closedText(existing);
    }
    const now = new Date();
    if (task.shouldEscalate(now)) {
      await this.tasks.escalate(id);
      return escalatedText(task);
    }
    return reportedText(task, task.roundInFlight(now));
  }
}
