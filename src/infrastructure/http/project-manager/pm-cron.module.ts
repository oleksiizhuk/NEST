import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProjectManagerModule } from '@infrastructure/project-manager/project-manager.module';
import { TelegramInfraModule } from '@infrastructure/telegram/telegram.module';
import { PmCronController } from '@infrastructure/http/project-manager/pm-cron.controller';
import { CronSecretGuard } from '@infrastructure/http/project-manager/cron-secret.guard';
import { PostDailyDigestUseCase } from '@application/project-manager/use-cases/post-daily-digest.use-case';

@Module({
  imports: [ConfigModule, ProjectManagerModule, TelegramInfraModule],
  controllers: [PmCronController],
  providers: [CronSecretGuard, PostDailyDigestUseCase],
})
export class PmCronHttpModule {}
