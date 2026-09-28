import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AssistantModel,
  CODE_ASSISTANT_SERVICE,
  IAskResult,
  ICodeAssistantService,
} from '@application/mcp/code-assistant.service.interface';
import {
  IMcpTaskRepository,
  MCP_TASK_REPOSITORY,
} from '@domain/mcp-task/mcp-task.repository.interface';
import {
  DEFAULT_TASK_OWNER,
  MAX_DERIVED_GOAL_CHARS,
  MAX_REPLY_NOTE_CHARS,
  MAX_TASK_ROUNDS,
  McpTask,
} from '@domain/mcp-task/mcp-task.entity';
import { McpToolError } from '@application/mcp/mcp-tool.error';
import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import {
  answerFooter,
  closedText,
  escalatedText,
  inFlightText,
  needInfoFooter,
  failedCallText,
  noAnswerFooter,
  reportFirstText,
  unknownText,
} from '@application/mcp/task-protocol';

// Below this much material (context, or code pasted into the prompt after
// its first line) a question without a task has nothing to be grounded in:
// the caller gets the checklist first instead of an answer
export const THIN_CONTEXT_CHARS = 200;

export interface IAskAdviceRequest {
  prompt: string;
  context?: string;
  model?: AssistantModel;
  taskId?: string;
  owner?: string;
}

// Answers a question from an MCP client (an IDE agent such as Kiro) as one
// round of a task. Without a task: a bare question gets the checklist first,
// a question with material opens a task and is answered, so every answer
// asks for a report and nothing is left hanging.
@Injectable()
export class AskClaudeUseCase {
  private readonly logger = new Logger(AskClaudeUseCase.name);

  constructor(
    @Inject(CODE_ASSISTANT_SERVICE)
    private readonly assistant: ICodeAssistantService,
    @Inject(MCP_TASK_REPOSITORY)
    private readonly tasks: IMcpTaskRepository,
    private readonly startTask: StartTaskUseCase,
  ) {}

  async execute(request: IAskAdviceRequest): Promise<string> {
    const prompt = (request.prompt ?? '').trim();
    if (!prompt) {
      throw new McpToolError('prompt is empty: put your question in prompt.');
    }
    const context = request.context?.trim() || undefined;
    const owner = request.owner ?? DEFAULT_TASK_OWNER;
    // The first line of the question stands in for the goal
    const [firstLine, ...rest] = prompt.split('\n');
    const derivedGoal = () =>
      McpTask.clean(firstLine, MAX_DERIVED_GOAL_CHARS, true);
    const material = (context?.length ?? 0) + rest.join('\n').trim().length;

    let id = request.taskId?.trim().toLowerCase();
    if (!id) {
      if (material < THIN_CONTEXT_CHARS) {
        return this.startTask.execute({
          goal: derivedGoal(),
          context,
          owner,
          unanswered: true,
        });
      }
      id = (await this.tasks.create(McpTask.newId(), owner, derivedGoal(), []))
        .id;
    }

    const now = new Date();
    const task = await this.tasks.claimRound(id, owner, MAX_TASK_ROUNDS, now);
    if (!task) {
      return this.refusal(id, owner, now);
    }
    const claimedAt = task.inFlightSince ?? now;
    // Claiming a round leaves the status as it was: still answered means
    // the last answer was never reported on
    const unreported = task.awaitingReport;

    let result: IAskResult;
    try {
      result = await this.assistant.ask({
        prompt,
        context,
        model: request.model,
        task: {
          goal: task.goal,
          checklist: task.checklist,
          history: task.history,
          round: task.rounds,
          maxRounds: MAX_TASK_ROUNDS,
          unreported,
        },
      });
    } catch (error) {
      // A failed call must not use up the task, and a caller that sent no
      // task_id still needs the one that was opened for it
      await this.bestEffort('releaseRound', () =>
        this.tasks.releaseRound(task.id, claimedAt),
      );
      throw Object.assign(new McpToolError(failedCallText(task)), {
        cause: error,
      });
    }

    if (result.noAnswer) {
      await this.bestEffort('releaseRound', () =>
        this.tasks.releaseRound(task.id, claimedAt),
      );
      return `${result.text}\n\n${noAnswerFooter(task)}`;
    }

    // The answer is paid for: a failed bookkeeping write must not lose it
    // (the in-flight mark then lapses after ROUND_MAX_MS)
    const kind = result.needInfo ? 'need_info' : 'answer';
    await this.bestEffort('recordReply', () =>
      this.tasks.recordReply(task.id, claimedAt, kind, {
        at: new Date(),
        kind,
        // One line: what was asked for or the hypothesis, never the answer
        note: McpTask.clean(
          result.needInfo
            ? result.text
            : result.hypothesis ?? 'answer given (no hypothesis line)',
          MAX_REPLY_NOTE_CHARS,
          true,
        ),
      }),
    );

    const footer = result.needInfo
      ? needInfoFooter(task)
      : answerFooter(task, unreported);
    return `${result.text}\n\n${footer}`;
  }

  private async bestEffort(what: string, write: () => Promise<void>) {
    try {
      await write();
    } catch (error) {
      this.logger.error(`${what} failed: ${(error as Error).message}`);
    }
  }

  // Why no round was taken: unknown, closed, busy, or out of rounds or
  // attempts. That escalates only once no round runs and the last answer is
  // reported on, so a parallel call cannot close a task under a round.
  private async refusal(id: string, owner: string, now: Date) {
    const task = await this.tasks.findById(id, owner);
    if (!task) return unknownText(id);
    if (!task.isOpen) return closedText(task);
    // Under both caps, a refused claim can only mean a round is running
    if (task.roundInFlight(now) || !(task.onLastRound || task.outOfAttempts)) {
      return inFlightText(task);
    }
    if (task.awaitingReport) return reportFirstText(task);
    await this.tasks.escalate(id, now);
    return escalatedText(task);
  }
}
