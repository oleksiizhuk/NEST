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
  TaskPriority,
  TaskType,
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
          'Short task title, max ~120 chars. ALWAYS IN ENGLISH, whatever language ' +
          'the chat uses — translate the request. Neutral business language: the ' +
          'board is read by the whole team, so no slang, surzhyk, profanity or roleplay.',
      },
      description: {
        type: 'string',
        description:
          'Task description in ENGLISH. Write a task, not a specification.\n' +
          'Default shape — a short paragraph of what and why, then, if anything was left ' +
          'unsaid, a blank line and:\n' +
          'Open:\n' +
          '- one line per unknown, phrased as a question\n\n' +
          'Add "Acceptance criteria:" with 1-3 "- Given <state>, when <action>, then ' +
          '<observable result>" lines ONLY when the task changes how something behaves and ' +
          'someone will have to check it. A decision, a reminder, a backlog note or a ' +
          '"postpone this" has nothing to accept — leave the section out entirely rather ' +
          'than inventing criteria.\n\n' +
          'NEVER invent a number, date, deadline, limit, version, name or owner the user did ' +
          'not give. If a value is needed but unknown, keep it out of the description and put ' +
          'it under Open instead. A one-sentence request makes a three-line task with two ' +
          'open questions — that is correct, do not pad it. Neutral business language, no ' +
          'slang or roleplay.',
      },
      type: {
        type: 'string',
        enum: ['Task', 'Bug', 'Story'],
        description:
          'Bug only for something that is broken now, Story for a user-facing feature, ' +
          'Task otherwise. Defaults to Task.',
      },
      priority: {
        type: 'string',
        enum: ['Blocker', 'High', 'Normal', 'Low'],
        description:
          'Blocker only when it stops everything right now; High when it blocks a feature ' +
          'or sits on the core path; Low for polish. Omit for regular work — do not read ' +
          'urgency into a neutral request.',
      },
    },
    required: ['summary', 'description'],
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
          'New title, ALWAYS IN ENGLISH. Neutral business language — no slang, ' +
          'surzhyk, profanity or roleplay.',
      },
      description: {
        type: 'string',
        description:
          'New description, replacing the old one completely. ALWAYS IN ENGLISH, same four ' +
          'sections and the same no-invented-values rule as create_jira_task. When the user ' +
          'answers an open question, move the answer into Scope or Acceptance criteria and ' +
          'delete its OPEN line — never leave both.',
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
const DESCRIPTION_LIMIT = 4000;

// The persona swears; the Jira board is seen by the whole team. Roots cover the
// usual Ukrainian/Russian forms with their prefixes and endings.
const PROFANITY =
  /\S*(?:хуй|хуе|хуё|хуї|пизд|піzd|піzd|бля|бляд|єбат|ебат|єбан|ебан|їбат|їбан|заєб|заеб|наєб|наеб|доєб|уєб|уеб|підар|пидор|гандон|мудак|мудил|срак|гівн|говн)\S*/giu;

// Newlines carry the description's structure, so only spaces and tabs collapse
const clean = (text: string): string =>
  (text ?? '')
    .replace(PROFANITY, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Jira rejects a summary containing newlines
const cleanSummary = (text: string): string => clean(text).replace(/\s+/g, ' ');

// The model is told to list what it does not know; surfacing that in the chat
// is the only way the asker learns the task has holes
// Two shapes reach us: an "Open:" heading followed by bullets, and stray
// "- OPEN: …" lines. Both mean the same thing to the reader of the chat.
const OPEN_HEADING = /^\s*open\b\s*:?\s*$/i;
const OPEN_INLINE = /^\s*[-*•]?\s*OPEN\b[:\s]/i;
const BULLET = /^\s*[-*•]\s+(.+)$/;

const openQuestions = (description?: string): string[] => {
  const found: string[] = [];
  let underHeading = false;

  for (const line of (description ?? '').split('\n')) {
    if (OPEN_HEADING.test(line)) {
      underHeading = true;
      continue;
    }
    if (OPEN_INLINE.test(line)) {
      found.push(line.replace(/^\s*[-*•]?\s*OPEN\b[:\s]*/i, '').trim());
      continue;
    }
    const bullet = BULLET.exec(line);
    if (underHeading && bullet) {
      found.push(bullet[1].trim());
      continue;
    }
    if (line.trim()) underHeading = false;
  }
  return found.filter(Boolean);
};

// Keeps the reply readable when the model dumps a whole spec into the field
const RECEIPT_FIELD_LIMIT = 300;

const trim = (text: string): string =>
  text.length > RECEIPT_FIELD_LIMIT
    ? `${text.slice(0, RECEIPT_FIELD_LIMIT)}…`
    : text;

// Per-request tool state — scoped to a single generateReply() call
interface ToolState {
  createdTask: ICreatedTask | null;
  // What actually reached Jira, appended to the reply verbatim so the user
  // sees the real title and description instead of the model's retelling
  receipt: string | null;
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
    const state: ToolState = { createdTask: null, receipt: null };

    for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10024,
        // thinking would eat into the 10024-token budget for a chat bot
        thinking: { type: 'disabled' },
        system: [
          {
            type: 'text',
            text: TELEGRAM_SYSTEM_PROMPT,
            // tools render before system, so this one breakpoint caches both
            cache_control: { type: 'ephemeral' },
          },
        ],
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

  // What Jira accepted is appended verbatim rather than left to the model: in
  // character it mangles keys, glues URLs to words and retells the title in
  // surzhyk, so the user cannot tell what actually landed on the board
  private finalise(text: string, state: ToolState): string {
    const body = text.trim();

    if (!state.receipt) return body || AI_UNAVAILABLE_REPLY;
    return `${body ? `${body}\n\n` : ''}${state.receipt}`;
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
        const { summary, description, type, priority } = block.input as {
          summary: string;
          description?: string;
          type?: TaskType;
          priority?: TaskPriority;
        };
        // Jira rejects summaries past 255 chars and refuses newlines in them
        const sentSummary = cleanSummary(summary).slice(0, SUMMARY_LIMIT);
        const sentDescription = description
          ? clean(description).slice(0, DESCRIPTION_LIMIT)
          : undefined;
        const task = await this.taskTracker.createTask({
          summary: sentSummary,
          description: sentDescription,
          type,
          priority,
        });
        state.createdTask = task;

        const open = openQuestions(sentDescription);
        state.receipt = [
          `${task.key} — ${task.url}`,
          `Заголовок: ${trim(sentSummary)}`,
          `Тип: ${type ?? 'Task'}${priority ? ` · ${priority}` : ''}`,
          open.length
            ? `Треба уточнити:\n${open.map((q) => `• ${q}`).join('\n')}`
            : 'Питань нема — усе було в повідомленні',
        ].join('\n');
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

        const changes = {
          ...(summary
            ? { summary: cleanSummary(summary).slice(0, SUMMARY_LIMIT) }
            : {}),
          ...(description
            ? { description: clean(description).slice(0, DESCRIPTION_LIMIT) }
            : {}),
        };
        const task = await this.taskTracker.updateTask(
          key.trim().toUpperCase(),
          changes,
        );
        state.receipt = [
          `${task.key} — ${task.url}`,
          ...(changes.summary
            ? [`Новий заголовок: ${trim(changes.summary)}`]
            : []),
          ...(changes.description
            ? [`Новий опис: ${trim(changes.description)}`]
            : []),
        ].join('\n');
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
        state.receipt = `${task.key} — ${task.url}\nСтатус: ${task.status}`;
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
