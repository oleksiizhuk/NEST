import { Inject, Injectable } from '@nestjs/common';
import {
  CODE_ASSISTANT_SERVICE,
  ICodeAssistantService,
} from '@application/mcp/code-assistant.service.interface';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  DEFAULT_TASK_OWNER,
  MAX_GOAL_CHARS,
  MAX_REPLY_NOTE_CHARS,
  McpTask,
} from '@domain/mcp-task/mcp-task.entity';
import { needsReminder, startedText } from '@application/mcp/task-protocol';
import { McpToolError } from '@application/mcp/mcp-tool.error';

const CHECKLIST_ITEM_CHARS = MAX_REPLY_NOTE_CHARS;

// Opens a task: a checklist of what the caller must collect before asking,
// and a reminder of the caller's tasks still waiting for a report
@Injectable()
export class StartTaskUseCase {
  constructor(
    @Inject(CODE_ASSISTANT_SERVICE)
    private readonly assistant: ICodeAssistantService,
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
  ) {}

  async execute(request: {
    goal: string;
    context?: string;
    owner?: string;
    // ask_advice without material: say the question is not answered yet
    unanswered?: boolean;
  }): Promise<string> {
    const goal = McpTask.clean(request.goal ?? '', MAX_GOAL_CHARS, true);
    if (!goal) {
      throw new McpToolError(
        'goal is empty: say in a sentence what must work in the end.',
      );
    }
    const owner = request.owner ?? DEFAULT_TASK_OWNER;
    const context = request.context?.trim() || undefined;

    const checklist = (await this.assistant.plan({ goal, context })).map((c) =>
      McpTask.clean(c, CHECKLIST_ITEM_CHARS, true),
    );
    // Old ones too: an abandoned task is exactly the one that hangs
    const now = new Date();
    const waiting = (await this.tasks.listOpen(owner, 20))
      .filter((t) => needsReminder(t, now))
      .slice(0, 3);
    // A bare ask_advice lands here too: it still skipped start_task
    const task = await this.tasks.create(
      McpTask.newId(),
      owner,
      goal,
      checklist,
      request.unanswered ? 'ask_advice' : 'start_task',
    );
    return startedText(task, waiting, request.unanswered);
  }
}
