import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';

export const MCP_SERVER_NAME = 'nest-claude';
export const MCP_SERVER_VERSION = '1.0.0';

// One MCP server per HTTP request: the transport is stateless (serverless),
// so there is nothing to keep between calls. Building it is cheap.
export function createMcpServer(askClaude: AskClaudeUseCase): McpServer {
  const server = new McpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    'ask_claude',
    {
      title: 'Ask Claude',
      description:
        'Ask Claude (Anthropic) a software engineering question and get a ' +
        'direct answer: explain code, review a diff, suggest an implementation, ' +
        'debug an error. Put the question in `prompt`; put the relevant file ' +
        'contents, diff or error output in `context` so the answer is grounded ' +
        'in the real code. Single-turn — include everything needed in one call.',
      inputSchema: {
        prompt: z.string().min(1).describe('The question or instruction'),
        context: z
          .string()
          .optional()
          .describe(
            'Optional source code, diff, logs or other material the answer should use',
          ),
      },
    },
    async ({ prompt, context }) => {
      try {
        const answer = await askClaude.execute({ prompt, context });
        return { content: [{ type: 'text', text: answer }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `ask_claude failed: ${(error as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}
