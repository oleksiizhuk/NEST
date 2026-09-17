import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { ASSISTANT_MODELS } from '@application/mcp/code-assistant.service.interface';

export const MCP_SERVER_NAME = 'nest-claude';
export const MCP_SERVER_VERSION = '1.1.0';

// Upper bounds on the request so a single call cannot run up an unbounded
// bill or blow past the body limit. Generous enough for a file plus a diff.
export const MAX_PROMPT_CHARS = 50_000;
export const MAX_CONTEXT_CHARS = 200_000;

const logger = new Logger('McpServerFactory');

// One MCP server per HTTP request: the transport is stateless (serverless),
// so there is nothing to keep between calls. Building it is cheap.
export function createMcpServer(askClaude: AskClaudeUseCase): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    'ask_advice',
    {
      title: 'Ask for coding advice',
      description:
        'Ask an expert software engineering assistant a question and get a ' +
        'direct answer: explain code, review a diff, suggest an implementation, ' +
        'debug an error. Put the question in `prompt`; put the relevant file ' +
        'contents, diff or error output in `context` so the answer is grounded ' +
        'in the real code. Single-turn — include everything needed in one call. ' +
        'Pick `model` by difficulty, in this order: sonnet is fastest and ' +
        'cheapest for straightforward questions; opus is the default and ' +
        'handles most work, including design, reviews and hard bugs; fable is ' +
        'the strongest and slowest, for the hardest problems opus cannot ' +
        'crack. ' +
        'Privacy: this service does not save your prompt, context or the ' +
        'answer to any database and does not write them to its logs. They are ' +
        'held only in memory for the single request and dropped once the ' +
        'answer is returned.',
      inputSchema: {
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
            'Optional source code, diff, logs or other material the answer should use',
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
    async ({ prompt, context, model }) => {
      try {
        const answer = await askClaude.execute({ prompt, context, model });
        return { content: [{ type: 'text', text: answer }] };
      } catch (error) {
        // Log the real cause server-side (message + stack carry no request
        // body), but hand the client a generic failure so SDK internals and
        // upstream detail do not leak over the wire.
        logger.error(
          `ask_advice failed: ${(error as Error).message}`,
          (error as Error).stack,
        );
        return {
          content: [
            {
              type: 'text',
              text: 'ask_advice could not complete the request. Check the server logs for the cause.',
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
