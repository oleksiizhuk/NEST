import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  ADMIN_TARGETS,
  IAdminTargets,
} from '@application/project-manager/staging-admin.interface';
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
    @Inject(ADMIN_TARGETS) private readonly targets: IAdminTargets,
  ) {}

  // Read-only health of each test environment: can the bot sign in and see
  // malls and categories. Creates nothing.
  @Get('targets')
  async checkTargets() {
    return Promise.all(
      this.targets.tiers().map(async (tier) => {
        const admin = this.targets.target(tier);
        try {
          const [malls, categories] = await Promise.all([
            admin.findMalls(''),
            admin.findCategories(''),
          ]);
          return {
            tier,
            host: admin.describeTarget(),
            ok: true,
            malls: malls.length,
            categories: categories.length,
            sampleMalls: malls.slice(0, 5).map((m) => m.name),
          };
        } catch (error) {
          return {
            tier,
            host: admin.describeTarget(),
            ok: false,
            error: String((error as Error).message).slice(0, 200),
          };
        }
      }),
    );
  }

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
        // Enough to diagnose "could not read …" lines; the endpoint is
        // behind CRON_SECRET
        preview: s.text.slice(0, 400),
      })),
    };
  }

  // Refreshes the snapshot, then posts the digest to the configured chat
  @Get('daily')
  daily() {
    return this.digest.execute();
  }
}
