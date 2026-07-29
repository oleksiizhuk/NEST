import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  IAiReplyService,
  IConversationTurn,
} from '@application/telegram/ai-reply.service.interface';
import {
  ICreatedTask,
  ITaskTrackerService,
  TASK_TRACKER_SERVICE,
} from '@application/telegram/task-tracker.service.interface';
import { TELEGRAM_SYSTEM_PROMPT } from '@infrastructure/telegram/telegram.system-prompt';

const DEFAULT_MODEL = 'claude-sonnet-5';
// tool_use -> tool_result -> final text; guards against runaway loops
const MAX_TOOL_ITERATIONS = 3;

const CREATE_JIRA_TASK_TOOL: Anthropic.Tool = {
  name: 'create_jira_task',
  description:
    'Create a task in the Jira board. Call this when the user asks to create a task, ticket, or issue ' +
    '(e.g. "створи таску", "создай задачу", "add a ticket"). ' +
    'Derive a short imperative summary from the request; put remaining details into the description.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Short task title, max ~120 chars',
      },
      description: {
        type: 'string',
        description: 'Optional longer description of the task',
      },
    },
    required: ['summary'],
  },
};

// Per-request tool state — scoped to a single generateReply() call
interface ToolState {
  createdTask: ICreatedTask | null;
}

@Injectable()
export class AnthropicReplyService implements IAiReplyService {
  private readonly logger = new Logger(AnthropicReplyService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    configService: ConfigService,
    @Inject(TASK_TRACKER_SERVICE)
    private readonly taskTracker: ITaskTrackerService,
  ) {
    this.client = new Anthropic({
      apiKey: configService.get<string>('ANTHROPIC_KEY'),
    });
    this.model =
      configService.get<string>('TELEGRAM_AI_MODEL') || DEFAULT_MODEL;
  }

  async generateReply(
    userText: string,
    history: IConversationTurn[] = [],
  ): Promise<string> {
    const messages: Anthropic.MessageParam[] = [];
    for (const turn of history) {
      messages.push({ role: 'user', content: turn.userText });
      messages.push({ role: 'assistant', content: turn.botResponse });
    }
    messages.push({ role: 'user', content: userText });
    // One task per user message: the model gets a single tool call per turn
    // (disable_parallel_tool_use) and runTool refuses any further one
    const state: ToolState = { createdTask: null };

    for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10024,
        // thinking would eat into the 10024-token budget for a chat bot
        thinking: { type: 'disabled' },
        system: TELEGRAM_SYSTEM_PROMPT,
        tools: [CREATE_JIRA_TASK_TOOL],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        return this.extractText(response);
      }

      // Append the assistant turn (with tool_use blocks), then all tool results
      messages.push({ role: 'assistant', content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        toolResults.push(await this.runTool(block, state));
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return 'Не вдалося завершити операцію 😢';
  }

  private async runTool(
    block: Anthropic.ToolUseBlock,
    state: ToolState,
  ): Promise<Anthropic.ToolResultBlockParam> {
    try {
      if (block.name === 'create_jira_task') {
        if (state.createdTask) {
          this.logger.warn(
            `Refused a second create_jira_task after ${state.createdTask.key}`,
          );
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content:
              `Limit reached: task ${state.createdTask.key} (${state.createdTask.url}) ` +
              'was already created for this request. Only one task per user message is ' +
              'allowed — do not call this tool again, just confirm the existing task.',
            is_error: true,
          };
        }
        const { summary, description } = block.input as {
          summary: string;
          description?: string;
        };
        const task = await this.taskTracker.createTask(summary, description);
        state.createdTask = task;
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Created ${task.key}: ${task.url}`,
        };
      }
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Unknown tool: ${block.name}`,
        is_error: true,
      };
    } catch (error) {
      this.logger.error(error);
      return {
        type: 'tool_result',
        tool_use_id: block.id,
        content: `Failed: ${(error as Error).message}`,
        is_error: true,
      };
    }
  }

  private extractText(response: Anthropic.Message): string {
    const block = response.content.find((b) => b.type === 'text');
    return block && 'text' in block ? block.text : '';
  }
}
