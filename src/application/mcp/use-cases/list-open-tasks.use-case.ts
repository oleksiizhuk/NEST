import { Inject, Injectable } from '@nestjs/common';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import { MAX_TASK_ROUNDS } from '@domain/mcp-task/mcp-task.entity';

const LIMIT = 20;

// Open tasks, so a caller that lost the thread can pick one up or report it
@Injectable()
export class ListOpenTasksUseCase {
  constructor(
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
  ) {}

  async execute(now = new Date()): Promise<string> {
    const open = await this.tasks.listOpen(LIMIT);
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
        return `- ${t.id}: ${t.goal} [${flags.join(', ')}]`;
      }),
      '',
      'Continue one with ask_advice { task_id }, or close it with ' +
        'report_outcome { task_id, status, details }.',
    ].join('\n');
  }
}
