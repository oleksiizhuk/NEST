import { Inject, Injectable } from '@nestjs/common';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import { McpToolError } from '@application/mcp/mcp-tool.error';
import {
  DEFAULT_TASK_OWNER,
  MAX_NOTE_CHARS,
  McpOutcome,
  McpTask,
} from '@domain/mcp-task/mcp-task.entity';
import {
  closedText,
  escalatedText,
  reportInFlightText,
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
    owner?: string;
  }): Promise<string> {
    const id = request.taskId.trim().toLowerCase();
    const owner = request.owner ?? DEFAULT_TASK_OWNER;
    // One line: a report cannot fake extra lines of the <task> block or a
    // NEXT STEP in the texts it is shown in
    const details = McpTask.clean(request.details ?? '', MAX_NOTE_CHARS, true);
    if (!details) {
      throw new McpToolError(
        'details is empty: say what you changed, what you ran and what you saw.',
      );
    }

    const event = {
      at: new Date(),
      kind: 'report' as const,
      note: details,
      outcome: request.status,
    };
    // A report during a running round would be about the previous answer
    // and get overwritten when the round ends: the write refuses it, and
    // the caller is told to wait
    const now = new Date();
    const task = await this.tasks.report(id, owner, request.status, event, now);
    if (!task) {
      const existing = await this.tasks.findById(id, owner);
      if (!existing) return unknownText(id);
      if (existing.roundInFlight(now)) return reportInFlightText(existing);
      if (existing.status === 'escalated' && request.status === 'solved') {
        const solved = await this.tasks.resolveEscalated(id, owner, event);
        if (solved) return reportedText(solved);
      }
      return closedText(existing);
    }
    if (task.shouldEscalate(now)) {
      await this.tasks.escalate(id, now);
      return escalatedText(task);
    }
    return reportedText(task);
  }
}
