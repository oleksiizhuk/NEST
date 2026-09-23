import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  IPendingActions,
  PENDING_ACTIONS,
} from '@application/project-manager/pending-action.interface';
import { AnswerProjectQuestionUseCase } from '@application/project-manager/use-cases/answer-project-question.use-case';
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
    @Inject(PENDING_ACTIONS) private readonly actions: IPendingActions,
    private readonly answer: AnswerProjectQuestionUseCase,
  ) {}

  // Last proposals with their outcome (the audit trail)
  @Get('actions')
  async recentActions() {
    return (await this.actions.recent(15)).map((a) => ({
      id: a.id,
      kind: a.kind,
      status: a.status,
      createdAt: a.createdAt,
      summary: a.summary,
      result: a.result,
    }));
  }

  // Runs one question through the PM pipeline outside Telegram and returns
  // the answer or the exact error. Chat id 0: nothing is posted anywhere,
  // and a proposal it creates can never be confirmed from a chat.
  @Get('ask')
  async ask(@Query('q') q?: string) {
    const question = (q ?? '').slice(0, 500);
    if (!question) return { error: 'pass ?q=' };
    const started = Date.now();
    try {
      const result = await this.answer.execute(`diagnostics: ${question}`, [], {
        chatId: 0,
        requesterId: 0,
      });
      return {
        seconds: (Date.now() - started) / 1000,
        text: result.text,
        proposal: result.proposal
          ? {
              id: result.proposal.id,
              kind: result.proposal.kind,
              summary: result.proposal.summary,
            }
          : null,
      };
    } catch (error) {
      return {
        seconds: (Date.now() - started) / 1000,
        error: String((error as Error)?.message ?? error).slice(0, 2000),
      };
    }
  }

  // Read-only health of each test environment: can the bot sign in and see
  // malls and categories. Creates nothing.
  @Get('targets')
  async checkTargets() {
    const pairs = this.targets
      .tiers()
      .flatMap((tier) =>
        this.targets.roles(tier).map((role) => ({ tier, role })),
      );
    // One after another: accounts may be shared between roles
    const results: unknown[] = [];
    for (const { tier, role } of pairs) {
      results.push(
        await (async () => {
          const admin = this.targets.target(tier, role);
          try {
            const tokenRole = await admin.whoAmI();
            const [malls, categories] = await Promise.all([
              admin.findMalls(''),
              admin.findCategories(''),
            ]);
            return {
              tier,
              role,
              tokenRole,
              host: admin.describeTarget(),
              ok: true,
              malls: malls.length,
              categories: categories.length,
              sampleMalls: malls.slice(0, 5).map((m) => m.name),
            };
          } catch (error) {
            return {
              tier,
              role,
              host: admin.describeTarget(),
              ok: false,
              error: String((error as Error).message).slice(0, 200),
            };
          }
        })(),
      );
    }
    return results;
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
