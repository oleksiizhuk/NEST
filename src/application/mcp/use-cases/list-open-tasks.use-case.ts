import { Inject, Injectable } from '@nestjs/common';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  DEFAULT_TASK_OWNER,
  MAX_TASK_ROUNDS,
} from '@domain/mcp-task/mcp-task.entity';

const LIMIT = 20;

// The caller's open tasks, so one that lost the thread can pick a task up
// or report on it
@Injectable()
export class ListOpenTasksUseCase {
  constructor(
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
  ) {}

  async execute(owner = DEFAULT_TASK_OWNER, now = new Date()): Promise<string> {
    const open = await this.tasks.listOpen(owner, LIMIT);
    if (!open.length) {
      return 'No open tasks.';
    }
    return [
      'Open tasks (most recent first):',
      ...open.map((t) => {
        const flags = [
          t.awaitingReport ? 'WAITING FOR YOUR REPORT' : t.status,
          `round ${t.rounds} of ${MAX_TASK_ROUNDS}`,
          t.isStale(now) ? 'no activity for over a day' : '',
        ].filter(Boolean);
        return `- ${t.id}: "${t.goal}" [${flags.join(', ')}]`;
      }),
      '',
      'Continue one with ask_advice { task_id }, or close it with ' +
        'report_outcome { task_id, status, details }.',
    ].join('\n');
  }
}
