import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CODE_ASSISTANT_SERVICE } from '@application/mcp/code-assistant.service.interface';
import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import { ReportOutcomeUseCase } from '@application/mcp/use-cases/report-outcome.use-case';
import { ListOpenTasksUseCase } from '@application/mcp/use-cases/list-open-tasks.use-case';
import { MCP_TASK_REPOSITORY } from '@domain/mcp-task/mcp-task.repository.interface';
import { MCP_USAGE_REPOSITORY } from '@domain/mcp-task/mcp-usage.repository.interface';
import { MongoMcpUsageRepository } from '@infrastructure/database/repositories/mongo-mcp-usage.repository';
import {
  GetMcpStatsUseCase,
  MCP_DAILY_BUDGET,
} from '@application/mcp/use-cases/get-mcp-stats.use-case';
import { mcpDailyLimit } from '@application/mcp/mcp-budget';
import { McpStatsController } from '@infrastructure/http/mcp/mcp-stats.controller';
import { ConfigService } from '@nestjs/config';
import { MongoMcpTaskRepository } from '@infrastructure/database/repositories/mongo-mcp-task.repository';
import {
  McpTaskDocument,
  McpTaskSchema,
} from '@infrastructure/database/schemas/mcp-task.schema';
import { AnthropicCodeAssistantService } from '@infrastructure/anthropic/anthropic-code-assistant.service';
import { McpController } from '@infrastructure/http/mcp/mcp.controller';
import {
  McpStatsTokenGuard,
  McpTokenGuard,
} from '@infrastructure/http/mcp/guards/mcp-token.guard';
import { McpDailyLimitGuard } from '@infrastructure/http/mcp/guards/mcp-daily-limit.guard';
import {
  McpUsageDocument,
  McpUsageSchema,
} from '@infrastructure/database/schemas/mcp-usage.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: McpUsageDocument.name, schema: McpUsageSchema },
      { name: McpTaskDocument.name, schema: McpTaskSchema },
    ]),
  ],
  controllers: [McpController, McpStatsController],
  providers: [
    {
      provide: CODE_ASSISTANT_SERVICE,
      useClass: AnthropicCodeAssistantService,
    },
    { provide: MCP_TASK_REPOSITORY, useClass: MongoMcpTaskRepository },
    { provide: MCP_USAGE_REPOSITORY, useClass: MongoMcpUsageRepository },
    GetMcpStatsUseCase,
    {
      provide: MCP_DAILY_BUDGET,
      useFactory: (config: ConfigService) =>
        mcpDailyLimit(config.get<string>('MCP_DAILY_LIMIT')),
      inject: [ConfigService],
    },
    AskClaudeUseCase,
    StartTaskUseCase,
    ReportOutcomeUseCase,
    ListOpenTasksUseCase,
    McpTokenGuard,
    McpStatsTokenGuard,
    McpDailyLimitGuard,
  ],
})
export class McpHttpModule {}
