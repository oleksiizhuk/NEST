import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { ASSISTANT_MODELS } from '@application/mcp/code-assistant.service.interface';

export const MCP_SERVER_NAME = 'nest-claude';
export const MCP_SERVER_VERSION = '1.1.0';

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
        'Pick `model` per call: opus (default) for design, reviews and hard bugs; ' +
        'sonnet when speed and cost matter more than depth; fable for the ' +
        'hardest problems where opus is not enough. ' +
        'Privacy: this service does not save your prompt, context or the ' +
        'answer to any database and does not write them to its logs. They are ' +
        'held only in memory for the single request and dropped once the ' +
        'answer is returned.',
      inputSchema: {
        prompt: z.string().min(1).describe('The question or instruction'),
        context: z
          .string()
          .optional()
          .describe(
            'Optional source code, diff, logs or other material the answer should use',
          ),
        model: z
          .enum(ASSISTANT_MODELS)
          .optional()
          .describe(
            'Which model answers: opus (default, balanced), sonnet (fastest, ' +
              'cheapest), fable (strongest, slowest)',
          ),
      },
    },
    async ({ prompt, context, model }) => {
      try {
        const answer = await askClaude.execute({ prompt, context, model });
        return { content: [{ type: 'text', text: answer }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `ask_advice failed: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
