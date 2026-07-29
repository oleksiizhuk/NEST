import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  IAiReplyService,
  IConversationTurn,
  AI_UNAVAILABLE_REPLY,
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
        description:
          'Short task title, max ~120 chars. Neutral business language — the ' +
          'board is read by the whole team, so no slang, surzhyk, profanity or ' +
          'roleplay, whatever style the chat uses.',
      },
      description: {
        type: 'string',
        description:
          'Optional longer description, same neutral business language as the summary.',
      },
    },
    required: ['summary'],
  },
};

const UPDATE_JIRA_TASK_TOOL: Anthropic.Tool = {
  name: 'update_jira_task',
  description:
    'Change the title or the description of an existing Jira task. Call this when ' +
    'the user asks to fix, rename, clarify or add detail to a task they name by key ' +
    '(e.g. "онови KAN-12", "перепиши заголовок у KAN-3"). ' +
    'Send only the fields that change — omitted fields are left as they are. ' +
    'The description is replaced, not appended: include the full new text.',
  input_schema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Task key exactly as the user gave it, e.g. KAN-12',
      },
      summary: {
        type: 'string',
        description:
          'New title. Neutral business language — no slang, surzhyk, profanity or roleplay.',
      },
      description: {
        type: 'string',
        description:
          'New description, replacing the old one. Same neutral business language.',
      },
    },
    required: ['key'],
  },
};

const TRANSITION_JIRA_TASK_TOOL: Anthropic.Tool = {
  name: 'transition_jira_task',
  description:
    'Move an existing Jira task to another status. Call this when the user asks to ' +
    'start, finish, reopen or otherwise move a task they name by key ' +
    '(e.g. "закрий KAN-12", "візьми KAN-3 в роботу"). ' +
    'If the status is not reachable the tool answers with the ones that are — ' +
    'pick from that list or ask the user, never guess twice.',
  input_schema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Task key exactly as the user gave it, e.g. KAN-12',
      },
      status: {
        type: 'string',
        description:
          'Target status as the board names it, e.g. "In Progress", "Done", "To Do"',
      },
    },
    required: ['key', 'status'],
  },
};

// KAN-12 and the like; anything else is the model inventing a key
const TASK_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

const SUMMARY_LIMIT = 250;
const DESCRIPTION_LIMIT = 2000;

// The persona swears; the Jira board is seen by the whole team. Roots cover the
// usual Ukrainian/Russian forms with their prefixes and endings.
const PROFANITY =
  /\S*(?:хуй|хуе|хуё|хуї|пизд|піzd|піzd|бля|бляд|єбат|ебат|єбан|ебан|їбат|їбан|заєб|заеб|наєб|наеб|доєб|уєб|уеб|підар|пидор|гандон|мудак|мудил|срак|гівн|говн)\S*/giu;

const clean = (text: string): string =>
  (text ?? '').replace(PROFANITY, '').replace(/\s+/g, ' ').trim();

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
        tools: [
          CREATE_JIRA_TASK_TOOL,
          UPDATE_JIRA_TASK_TOOL,
          TRANSITION_JIRA_TASK_TOOL,
        ],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        return this.finalise(this.extractText(response), state);
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

    // The loop ran out of turns — but the task may already exist, and telling
    // the user it failed would have them create a duplicate
    return this.finalise('', state);
  }

  // The key and the link come from Jira, not from the model: in character it
  // may mangle "KAN-12" or glue the URL to a word and break Telegram's autolink
  private finalise(text: string, state: ToolState): string {
    const task = state.createdTask;
    const body = text.trim();

    if (!task) return body || AI_UNAVAILABLE_REPLY;
    if (body.includes(task.key)) return body;
    return `${body ? `${body}\n\n` : ''}${task.key} — ${task.url}`;
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
        const task = await this.taskTracker.createTask(
          // Jira rejects summaries past 255 chars and keeps newlines out of them
          clean(summary).slice(0, SUMMARY_LIMIT),
          description
            ? clean(description).slice(0, DESCRIPTION_LIMIT)
            : undefined,
        );
        state.createdTask = task;
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Created ${task.key}: ${task.url}`,
        };
      }
      if (block.name === 'update_jira_task') {
        const { key, summary, description } = block.input as {
          key: string;
          summary?: string;
          description?: string;
        };

        if (!TASK_KEY.test((key ?? '').trim().toUpperCase())) {
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: `"${key}" is not a task key. Ask the user which task to update.`,
            is_error: true,
          };
        }
        if (!summary && !description) {
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content:
              'Nothing to change — send a new summary, description, or both.',
            is_error: true,
          };
        }

        const task = await this.taskTracker.updateTask(
          key.trim().toUpperCase(),
          {
            ...(summary
              ? { summary: clean(summary).slice(0, SUMMARY_LIMIT) }
              : {}),
            ...(description
              ? { description: clean(description).slice(0, DESCRIPTION_LIMIT) }
              : {}),
          },
        );
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Updated ${task.key}: ${task.url}`,
        };
      }
      if (block.name === 'transition_jira_task') {
        const { key, status } = block.input as { key: string; status: string };

        if (!TASK_KEY.test((key ?? '').trim().toUpperCase())) {
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: `"${key}" is not a task key. Ask the user which task to move.`,
            is_error: true,
          };
        }

        const task = await this.taskTracker.transitionTask(
          key.trim().toUpperCase(),
          status ?? '',
        );
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: `${task.key} is now "${task.status}": ${task.url}`,
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

  // A turn can carry several text blocks (typically around a tool call) —
  // taking only the first one silently truncated the reply
  private extractText(response: Anthropic.Message): string {
    return response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? block.text : ''))
      .join('\n\n')
      .trim();
  }
}
