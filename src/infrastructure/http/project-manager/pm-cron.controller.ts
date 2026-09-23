import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { CronSecretGuard } from '@infrastructure/http/project-manager/cron-secret.guard';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { PostDailyDigestUseCase } from '@application/project-manager/use-cases/post-daily-digest.use-case';

@ApiExcludeController()
@UseGuards(CronSecretGuard)
@Controller('cron/pm')
export class PmCronController {
  constructor(
    private readonly refresh: RefreshProjectSnapshotUseCase,
    private readonly digest: PostDailyDigestUseCase,
  ) {}

  @Get('refresh')
  async refreshSnapshot() {
    const snapshot = await this.refresh.execute();
    return {
      createdAt: snapshot.createdAt,
      sources: snapshot.sections.map((s) => ({
        source: s.source,
        ok: s.ok,
        chars: s.text.length,
        error: s.error,
      })),
    };
  }

  // Refreshes the snapshot, then posts the digest to the configured chat
  @Get('daily')
  daily() {
    return this.digest.execute();
  }
}
