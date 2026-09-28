import { Inject, Injectable } from '@nestjs/common';
import {
  CODE_ASSISTANT_SERVICE,
  ICodeAssistantService,
} from '@application/mcp/code-assistant.service.interface';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import { MAX_GOAL_CHARS, McpTask } from '@domain/mcp-task/mcp-task.entity';
import { newTaskId, startedText } from '@application/mcp/task-protocol';

// Opens a task: a checklist of what the caller must collect before asking,
// and a reminder of earlier tasks still waiting for a report
@Injectable()
export class StartTaskUseCase {
  constructor(
    @Inject(CODE_ASSISTANT_SERVICE)
    private readonly assistant: ICodeAssistantService,
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
  ) {}

  async execute(request: { goal: string; context?: string }): Promise<string> {
    const goal = McpTask.clip(request.goal ?? '', MAX_GOAL_CHARS);
    if (!goal) {
      throw new Error('goal must not be empty');
    }
    const context = request.context?.trim() || undefined;

    const checklist = await this.assistant.plan({ goal, context });
    const waiting = (await this.tasks.listOpen(10))
      .filter((t) => t.awaitingReport)
      .slice(0, 3);
    const task = await this.tasks.create(newTaskId(), goal, checklist);
    return startedText(task, waiting);
  }
}
