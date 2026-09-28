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

export const MCP_SERVER_NAME = 'nest-claude';
export const MCP_SERVER_VERSION = '2.0.0';

// Upper bounds on the request so a single call cannot run up an unbounded
// bill or blow past the body limit. Generous enough for a file plus a diff.
export const MAX_PROMPT_CHARS = 50_000;
export const MAX_CONTEXT_CHARS = 200_000;
const MAX_GOAL_INPUT_CHARS = 2_000;
const MAX_DETAILS_INPUT_CHARS = 10_000;
const TASK_ID = z
  .string()
  .regex(/^t-[0-9a-f]{10}$/)
  .describe('The task_id from start_task or an earlier ask_advice');

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
  '5. Always finish with report_outcome: solved, not_solved or partial, ' +
  'with what you ran and saw. If it is not solved, go back to step 3 with ' +
  `the new output. A task has ${MAX_TASK_ROUNDS} rounds; then hand it to ` +
  'the user. Never leave a task without a report; list_open_tasks shows ' +
  'what is waiting.\n' +
  'Privacy: your code and context are never stored or logged. A task keeps ' +
  'only its goal, the checklist, one-line notes per round and your reports, ' +
  'for 30 days.';

const logger = new Logger('McpServerFactory');

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

// Log the real cause server-side (message + stack carry no request body),
// but hand the client a generic failure so SDK internals and upstream
// detail do not leak over the wire.
const run = async (
  tool: string,
  work: () => Promise<string>,
): Promise<ToolResult> => {
  try {
    return { content: [{ type: 'text', text: await work() }] };
  } catch (error) {
    logger.error(
      `${tool} failed: ${(error as Error).message}`,
      (error as Error).stack,
    );
    return {
      content: [
        {
          type: 'text',
          text: `${tool} could not complete the request. Check the server logs for the cause.`,
        },
      ],
      isError: true,
    };
  }
};

// One MCP server per HTTP request: the transport is stateless (serverless),
// so there is nothing to keep between calls; task state lives in Mongo.
export function createMcpServer(useCases: McpUseCases): McpServer {
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
      run('start_task', () => useCases.startTask.execute({ goal, context })),
  );

  server.registerTool(
    'ask_advice',
    {
      title: 'Ask for coding advice',
      description:
        'Ask an expert software engineer: explain code, review a diff, ' +
        'suggest an implementation, debug an error. Pass the task_id from ' +
        'start_task (without one a new task is opened). Put the question in ' +
        '`prompt` and the collected file contents, diff, logs and docs in ' +
        '`context` so the answer is grounded in the real code. The reply ' +
        'either asks for missing material (NEED_INFO) or answers with a ' +
        '"How to verify" check, and ends with the NEXT STEP to take — follow ' +
        'it, and always finish with report_outcome. ' +
        'Pick `model` by difficulty: sonnet is fastest and cheapest for ' +
        'straightforward questions; opus is the default and handles most ' +
        'work, including design, reviews and hard bugs; fable is the ' +
        'strongest and slowest, for the hardest problems opus cannot crack. ' +
        'Privacy: prompt, context and the answer are never stored or ' +
        'logged; the task keeps only a one-line note per round.',
      inputSchema: {
        task_id: TASK_ID.optional(),
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
        useCases.ask.execute({ taskId: task_id, prompt, context, model }),
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
        status: z.enum(MCP_OUTCOMES as [string, ...string[]]),
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
          status: status as (typeof MCP_OUTCOMES)[number],
          details,
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
    () => run('list_open_tasks', () => useCases.listOpenTasks.execute()),
  );

  return server;
}
