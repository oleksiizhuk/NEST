import { Inject, Injectable } from '@nestjs/common';
import {
  AssistantModel,
  CODE_ASSISTANT_SERVICE,
  ICodeAssistantService,
} from '@application/mcp/code-assistant.service.interface';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  MAX_GOAL_CHARS,
  MAX_NOTE_CHARS,
  MAX_TASK_ROUNDS,
  McpTask,
} from '@domain/mcp-task/mcp-task.entity';
import {
  answerFooter,
  closedText,
  escalatedText,
  needInfoFooter,
  newTaskId,
  unknownText,
} from '@application/mcp/task-protocol';

export interface IAskAdviceRequest {
  prompt: string;
  context?: string;
  model?: AssistantModel;
  taskId?: string;
}

// Answers a question from an MCP client (an IDE agent such as Kiro) as one
// round of a task. A call without a task opens one, so every answer asks for
// a report and nothing is left hanging.
@Injectable()
export class AskClaudeUseCase {
  constructor(
    @Inject(CODE_ASSISTANT_SERVICE)
    private readonly assistant: ICodeAssistantService,
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
  ) {}

  async execute(request: IAskAdviceRequest): Promise<string> {
    const prompt = (request.prompt ?? '').trim();
    if (!prompt) {
      throw new Error('prompt must not be empty');
    }
    const context = request.context?.trim() || undefined;

    let id = request.taskId?.trim();
    if (!id) {
      // The first line of the question stands in for the goal
      const goal = McpTask.clip(prompt.split('\n')[0], MAX_GOAL_CHARS);
      id = (await this.tasks.create(newTaskId(), goal, [])).id;
    }

    const task = await this.tasks.claimRound(id, MAX_TASK_ROUNDS);
    if (!task) {
      return this.refusal(id);
    }

    const result = await this.assistant.ask({
      prompt,
      context,
      model: request.model,
      task: {
        goal: task.goal,
        checklist: task.checklist,
        history: task.history,
        round: task.rounds,
        maxRounds: MAX_TASK_ROUNDS,
      },
    });

    await this.tasks.recordReply(task.id, {
      at: new Date(),
      kind: result.needInfo ? 'need_info' : 'answer',
      note: McpTask.clip(
        result.needInfo
          ? result.text
          : result.hypothesis ?? 'answer given (no hypothesis line)',
        result.needInfo ? MAX_NOTE_CHARS : 300,
      ),
    });

    const footer = result.needInfo ? needInfoFooter(task) : answerFooter(task);
    return `${result.text}\n\n${footer}`;
  }

  // Why no round was taken: unknown, closed, or out of rounds
  private async refusal(id: string): Promise<string> {
    const task = await this.tasks.findById(id);
    if (!task) return unknownText(id);
    if (!task.isOpen) return closedText(task);
    await this.tasks.escalate(id);
    return escalatedText(task);
  }
}
