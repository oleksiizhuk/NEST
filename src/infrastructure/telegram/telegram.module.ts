import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TELEGRAM_GATEWAY } from '@application/telegram/telegram.gateway.interface';
import { AI_REPLY_SERVICE } from '@application/telegram/ai-reply.service.interface';
import { TELEGRAM_CONFIG } from '@application/telegram/telegram.config.interface';
import { TASK_TRACKER_SERVICE } from '@application/telegram/task-tracker.service.interface';
import { JiraService } from '@infrastructure/jira/jira.service';
import { DryRunTaskTracker } from '@infrastructure/jira/dry-run-task-tracker';
import { TELEGRAM_MESSAGE_REPOSITORY } from '@domain/telegram/telegram-message.repository.interface';
import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { TelegramMessageSchema } from '@infrastructure/database/schemas/telegram-message.schema';
import { MongoTelegramMessageRepository } from '@infrastructure/database/repositories/mongo-telegram-message.repository';
import { TelegramBotService } from '@infrastructure/telegram/telegram-bot.service';
import { AnthropicReplyService } from '@infrastructure/telegram/anthropic-reply.service';
import { TelegramPollingBootstrap } from '@infrastructure/telegram/telegram-polling.bootstrap';
import { telegramConfig } from '@infrastructure/telegram/telegram.config';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'TelegramMessage', schema: TelegramMessageSchema },
    ]),
  ],
  providers: [
    TelegramBotService,
    {
      provide: TELEGRAM_CONFIG,
      useFactory: telegramConfig,
      inject: [ConfigService],
    },
    // useExisting — one bot singleton shared by the gateway token and the polling bootstrap
    { provide: TELEGRAM_GATEWAY, useExisting: TelegramBotService },
    { provide: AI_REPLY_SERVICE, useClass: AnthropicReplyService },
    {
      // JIRA_DRY_RUN swaps the board for a stub: the model still runs, the
      // reply still shows what it would have filed, nothing is created
      provide: TASK_TRACKER_SERVICE,
      useFactory: (configService: ConfigService) =>
        configService.get<string>('JIRA_DRY_RUN') === 'true'
          ? new DryRunTaskTracker()
          : new JiraService(configService),
      inject: [ConfigService],
    },
    {
      provide: TELEGRAM_MESSAGE_REPOSITORY,
      useClass: MongoTelegramMessageRepository,
    },
    HandleTelegramMessageUseCase,
    TelegramPollingBootstrap,
  ],
  exports: [TELEGRAM_GATEWAY, TELEGRAM_CONFIG, HandleTelegramMessageUseCase],
})
export class TelegramInfraModule {}
