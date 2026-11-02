import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TelegramInfraModule } from '@infrastructure/telegram/telegram.module';
import { CronSecretGuard } from '@infrastructure/http/project-manager/cron-secret.guard';
import { JobWatchCronController } from '@infrastructure/http/job-watch/job-watch-cron.controller';
import { WatchJobBoardsUseCase } from '@application/job-watch/use-cases/watch-job-boards.use-case';
import { JOB_BOARD } from '@application/job-watch/job-board.interface';
import { SEEN_JOBS } from '@application/job-watch/seen-jobs.interface';
import { JOB_WATCH_CONFIG } from '@application/job-watch/job-watch.config.interface';
import { AshbyJobBoard } from '@infrastructure/job-watch/ashby-job-board';
import { jobWatchConfig } from '@infrastructure/job-watch/job-watch.config';
import { MongoSeenJobs } from '@infrastructure/database/repositories/mongo-seen-jobs';
import { JobWatchSeenSchema } from '@infrastructure/database/schemas/job-watch-seen.schema';

@Module({
  imports: [
    ConfigModule,
    TelegramInfraModule,
    MongooseModule.forFeature([
      { name: 'JobWatchSeen', schema: JobWatchSeenSchema },
    ]),
  ],
  controllers: [JobWatchCronController],
  providers: [
    CronSecretGuard,
    WatchJobBoardsUseCase,
    { provide: JOB_BOARD, useClass: AshbyJobBoard },
    { provide: SEEN_JOBS, useClass: MongoSeenJobs },
    {
      provide: JOB_WATCH_CONFIG,
      useFactory: jobWatchConfig,
      inject: [ConfigService],
    },
  ],
})
export class JobWatchHttpModule {}
