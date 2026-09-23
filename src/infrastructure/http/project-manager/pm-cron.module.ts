import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProjectManagerModule } from '@infrastructure/project-manager/project-manager.module';
import { TelegramInfraModule } from '@infrastructure/telegram/telegram.module';
import { PmCronController } from '@infrastructure/http/project-manager/pm-cron.controller';
import { PmKnowledgeController } from '@infrastructure/http/project-manager/pm-knowledge.controller';
import { CronSecretGuard } from '@infrastructure/http/project-manager/cron-secret.guard';
import { PostDailyDigestUseCase } from '@application/project-manager/use-cases/post-daily-digest.use-case';
import { WatchProjectUseCase } from '@application/project-manager/use-cases/watch-project.use-case';
import { RunGoldenEvalUseCase } from '@application/project-manager/use-cases/run-golden-eval.use-case';

@Module({
  imports: [ConfigModule, ProjectManagerModule, TelegramInfraModule],
  controllers: [PmCronController, PmKnowledgeController],
  providers: [
    CronSecretGuard,
    PostDailyDigestUseCase,
    WatchProjectUseCase,
    RunGoldenEvalUseCase,
  ],
})
export class PmCronHttpModule {}
