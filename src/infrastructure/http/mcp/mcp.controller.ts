import {
  All,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { createMcpServer } from '@infrastructure/mcp/mcp-server.factory';
import { McpTokenGuard } from '@infrastructure/http/mcp/guards/mcp-token.guard';

// MCP Streamable HTTP endpoint. Point an MCP client (Kiro, Claude Code,
// Cursor...) at POST /mcp with `Authorization: Bearer <MCP_TOKEN>`.
@ApiExcludeController()
@Controller('mcp')
@UseGuards(McpTokenGuard)
export class McpController {
  constructor(private readonly askClaude: AskClaudeUseCase) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Stateless: no session id, plain JSON reply. Each request gets a fresh
    // server + transport, which is what a serverless function can offer —
    // there is no process to keep a session in between invocations.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer(this.askClaude);

    res.on('close', () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  // GET (server-initiated SSE stream) and DELETE (session teardown) only
  // make sense for a stateful server. The spec's answer for a stateless
  // one is 405.
  @All()
  @HttpCode(405)
  unsupported(@Res() res: Response): void {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  }
}
