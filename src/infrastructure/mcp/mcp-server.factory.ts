import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import { ReportOutcomeUseCase } from '@application/mcp/use-cases/report-outcome.use-case';
import { ListOpenTasksUseCase } from '@application/mcp/use-cases/list-open-tasks.use-case';
import { ASSISTANT_MODELS } from '@application/mcp/code-assistant.service.interface';
import {
  MCP_OUTCOMES,
  MAX_TASK_ROUNDS,
} from '@domain/mcp-task/mcp-task.entity';
import { McpToolError } from '@application/mcp/mcp-tool.error';

export const MCP_SERVER_NAME = 'nest-claude';
export const MCP_SERVER_VERSION = '2.0.0';

// Upper bounds on the request so a single call cannot run up an unbounded
// bill or blow past the body limit. Generous enough for a file plus a diff.
export const MAX_PROMPT_CHARS = 50_000;
export const MAX_CONTEXT_CHARS = 200_000;
const MAX_GOAL_INPUT_CHARS = 2_000;
const MAX_DETAILS_INPUT_CHARS = 10_000;
// Tolerant of the slips a weak model makes: spaces, upper case, and "" for
// an optional id (= no task)
const TASK_ID = z
  .string()
  .regex(/^\s*t-[0-9a-f]{10}\s*$/i)
  .describe('The task_id from start_task or an earlier ask_advice');
const OPTIONAL_TASK_ID = z
  .string()
  .regex(/^\s*(t-[0-9a-f]{10})?\s*$/i)
  .optional()
  .describe(
    'The task_id from start_task or an earlier ask_advice; leave it out ' +
      'only for a first question that already has the code in context',
  );

// Tools that never call the model: the daily limit skips only these
export const FREE_TOOLS = ['report_outcome', 'list_open_tasks'];

export interface McpUseCases {
  ask: AskClaudeUseCase;
  startTask: StartTaskUseCase;
  reportOutcome: ReportOutcomeUseCase;
  listOpenTasks: ListOpenTasksUseCase;
}

// Sent to the client at initialize; IDE agents put it in their system prompt
const INSTRUCTIONS =
  'This server helps you solve hard coding problems with a senior engineer ' +
  'and keeps each problem as a task until it is solved. Follow this ' +
  'protocol:\n' +
  '1. start_task with the goal. You get a task_id and a checklist of what ' +
  'to collect.\n' +
  '2. Collect the checklist from the codebase and docs: read the files, ' +
  'run the commands, open the docs. Then call ask_advice with the task_id, ' +
  'your question in prompt and what you collected in context.\n' +
  '3. If the reply asks for more (NEED_INFO), collect exactly that and call ' +
  'ask_advice again with the same task_id.\n' +
  '4. Apply the answer and run its "How to verify" check.\n' +
  '5. Always call report_outcome: solved, not_solved or partial, with what ' +
  'you ran and saw (abandoned if you drop the task). If it is not solved, ' +
  'call ask_advice again with the same task_id and the new output.\n' +
  `A task has ${MAX_TASK_ROUNDS} rounds; after that, hand it to the user. ` +
  'Every reply ends with a NEXT STEP line: do exactly that. ' +
  'list_open_tasks shows what is waiting for your report.';

const logger = new Logger('McpServerFactory');

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

// Log the real cause server-side (message + stack carry no request body),
// but hand the client a generic failure so SDK internals and upstream
// detail do not leak over the wire.
// McpToolError messages are written for the caller (what to do next, the
// task_id) and pass through; anything else gets the generic text.
const run = async (
  tool: string,
  work: () => Promise<string>,
): Promise<ToolResult> => {
  try {
    return { content: [{ type: 'text', text: await work() }] };
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ?? error) as Error;
    logger.error(`${tool} failed: ${cause.message}`, cause.stack);
    return {
      content: [
        {
          type: 'text',
          text:
            error instanceof McpToolError
              ? error.message
              : `${tool} could not complete the request. Check the server logs for the cause.`,
        },
      ],
      isError: true,
    };
  }
};

// One MCP server per HTTP request: the transport is stateless (serverless),
// so there is nothing to keep between calls; task state lives in Mongo.
// `owner` names the calling client (X-MCP-Client); its task lists are its own
export function createMcpServer(
  useCases: McpUseCases,
  owner: string,
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    'start_task',
    {
      title: 'Start a task',
      description:
        'Call this first for any bug to fix or change to make. Opens a ' +
        'task and returns its task_id and a checklist of what to collect ' +
        '(code, errors, docs, versions, constraints, how to verify) before ' +
        'asking. Also lists earlier tasks still waiting for your report.',
      inputSchema: {
        goal: z
          .string()
          .min(1)
          .max(MAX_GOAL_INPUT_CHARS)
          .describe('What must work in the end, in one or two sentences'),
        context: z
          .string()
          .max(MAX_CONTEXT_CHARS)
          .optional()
          .describe('Optional: what you already know (error, file names)'),
      },
    },
    ({ goal, context }) =>
      run('start_task', () =>
        useCases.startTask.execute({ goal, context, owner }),
      ),
  );

  server.registerTool(
    'ask_advice',
    {
      title: 'Ask for coding advice',
      description:
        'Pass the task_id from start_task, do the NEXT STEP at the end of ' +
        'the reply, and finish with report_outcome. ' +
        'Asks an expert engineer: explain code, review a diff, suggest an ' +
        'implementation, debug an error. Question in `prompt`; the collected ' +
        'files, diff, logs and docs in `context`. Without a task_id and ' +
        'without code you get a checklist instead of an answer. The reply ' +
        'either asks for missing material (NEED_INFO) or answers with a ' +
        '"How to verify" check. `model`: sonnet (fast, cheap), opus ' +
        '(default), fable (hardest problems). Prompt, context and answers ' +
        'are never stored; a task keeps its goal and one-line notes.',
      inputSchema: {
        task_id: OPTIONAL_TASK_ID,
        prompt: z
          .string()
          .min(1)
          .max(MAX_PROMPT_CHARS)
          .describe('The question or instruction'),
        context: z
          .string()
          .max(MAX_CONTEXT_CHARS)
          .optional()
          .describe(
            'Source code, diff, logs, docs or other material the answer should use',
          ),
        model: z
          .enum(ASSISTANT_MODELS)
          .optional()
          .describe(
            'Which model answers, easiest to hardest: sonnet (fast, cheap), ' +
              'opus (default, most work), fable (strongest, slowest)',
          ),
      },
    },
    ({ task_id, prompt, context, model }) =>
      run('ask_advice', () =>
        useCases.ask.execute({
          taskId: task_id,
          prompt,
          context,
          model,
          owner,
        }),
      ),
  );

  server.registerTool(
    'report_outcome',
    {
      title: 'Report the outcome of a task',
      description:
        'Required after applying advice: say whether it worked. solved ' +
        'closes the task; not_solved or partial keeps it open and tells you ' +
        'what to send in the next ask_advice. Report even when it failed.',
      inputSchema: {
        task_id: TASK_ID,
        status: z.enum(MCP_OUTCOMES),
        details: z
          .string()
          .min(1)
          .max(MAX_DETAILS_INPUT_CHARS)
          .describe(
            'What you changed, what you ran to check it and what you saw ' +
              '(test result, new error). No full files.',
          ),
      },
    },
    ({ task_id, status, details }) =>
      run('report_outcome', () =>
        useCases.reportOutcome.execute({
          taskId: task_id,
          status,
          details,
          owner,
        }),
      ),
  );

  server.registerTool(
    'list_open_tasks',
    {
      title: 'List open tasks',
      description:
        'Open tasks with their status, marking the ones waiting for your ' +
        'report. Use it when you lost the task_id or before finishing work.',
      inputSchema: {},
    },
    () => run('list_open_tasks', () => useCases.listOpenTasks.execute(owner)),
  );

  return server;
}
