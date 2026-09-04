import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CODE_ASSISTANT_SERVICE } from '@application/mcp/code-assistant.service.interface';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { AnthropicCodeAssistantService } from '@infrastructure/anthropic/anthropic-code-assistant.service';
import { McpController } from '@infrastructure/http/mcp/mcp.controller';
import { McpTokenGuard } from '@infrastructure/http/mcp/guards/mcp-token.guard';

@Module({
  imports: [ConfigModule],
  controllers: [McpController],
  providers: [
    {
      provide: CODE_ASSISTANT_SERVICE,
      useClass: AnthropicCodeAssistantService,
    },
    AskClaudeUseCase,
    McpTokenGuard,
  ],
})
export class McpHttpModule {}
