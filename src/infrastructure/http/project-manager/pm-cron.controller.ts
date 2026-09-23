import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsArray } from 'class-validator';
import { WatchProjectUseCase } from '@application/project-manager/use-cases/watch-project.use-case';
import { RunGoldenEvalUseCase } from '@application/project-manager/use-cases/run-golden-eval.use-case';
import {
  IGoldenStore,
  PM_GOLDEN,
} from '@application/project-manager/golden.interface';
import {
  IPmMemory,
  PM_MEMORY,
} from '@application/project-manager/memory.interface';
import { parseGolden } from '@infrastructure/http/project-manager/golden.parser';

export class GoldenBody {
  @IsArray()
  cases: unknown[];
}
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
import {
  ITelegramMessageRepository,
  TELEGRAM_MESSAGE_REPOSITORY,
} from '@domain/telegram/telegram-message.repository.interface';
import { summarizeAnswers } from '@application/project-manager/answer-stats';

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
    @Inject(TELEGRAM_MESSAGE_REPOSITORY)
    private readonly messages: ITelegramMessageRepository,
    private readonly watcher: WatchProjectUseCase,
    private readonly evaluator: RunGoldenEvalUseCase,
    @Inject(PM_GOLDEN) private readonly golden: IGoldenStore,
    @Inject(PM_MEMORY) private readonly memory: IPmMemory,
  ) {}

  // Vercel Cron, a few times on weekdays: refresh, check the alert rules,
  // send each new event once. ?dry=1 lists what would fire from the latest
  // snapshot, sending and recording nothing.
  @Get('watch')
  async watch(@Query('dry') dry?: string) {
    const result = await this.watcher.execute(new Date(), dry === '1');
    return {
      dry: dry === '1',
      sent: result.sent,
      signals: result.signals.map((s) => ({ rule: s.rule, text: s.text })),
    };
  }

  // Vercel Cron, weekly: runs due golden questions, reports when all are done
  @Get('eval')
  eval() {
    return this.evaluator.execute();
  }

  @Get('golden')
  async goldenList() {
    return (await this.golden.all()).map((c) => ({
      id: c.id,
      question: c.question,
      last: c.last
        ? {
            at: c.last.at,
            pass: c.last.pass,
            seconds: c.last.seconds,
            failures: c.last.failures,
          }
        : null,
    }));
  }

  @Put('golden')
  async goldenReplace(@Body() body: GoldenBody) {
    let cases;
    try {
      cases = parseGolden(body.cases);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    await this.golden.replaceAll(cases);
    return { cases: cases.length };
  }

  @Get('memory')
  async memoryList() {
    return this.memory.active(new Date());
  }

  // Ratings, time and tokens of recent answers; the 👎 ones with their
  // questions, to turn into fixes or test questions
  @Get('feedback')
  async feedback(@Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return summarizeAnswers(await this.messages.recentAnswers(n));
  }

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
