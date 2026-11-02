import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CronSecretGuard } from '@infrastructure/http/project-manager/cron-secret.guard';
import { WatchJobBoardsUseCase } from '@application/job-watch/use-cases/watch-job-boards.use-case';

@ApiExcludeController()
@UseGuards(CronSecretGuard)
@Controller('cron/jobs')
export class JobWatchCronController {
  constructor(private readonly watch: WatchJobBoardsUseCase) {}

  // Vercel Cron, daily: announce new matching postings in Telegram.
  // ?dry=1 lists today's matches without sending or recording anything.
  @Get('watch')
  run(@Query('dry') dry?: string) {
    return this.watch.execute(new Date(), dry === '1');
  }
}
