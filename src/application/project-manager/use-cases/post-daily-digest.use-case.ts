import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import {
  IProjectManagerAiService,
  PM_AI_SERVICE,
} from '@application/project-manager/project-manager-ai.interface';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { todayLine } from '@application/project-manager/release-clock';

export const DIGEST_REQUEST =
  'Write the daily status digest for the team chat, following the digest ' +
  'format in your instructions.';

@Injectable()
export class PostDailyDigestUseCase {
  private readonly logger = new Logger(PostDailyDigestUseCase.name);

  constructor(
    private readonly refresh: RefreshProjectSnapshotUseCase,
    @Inject(PM_AI_SERVICE) private readonly ai: IProjectManagerAiService,
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(PM_CONFIG) private readonly config: IPmConfig,
  ) {}

  // Always rebuilds the snapshot first: the digest is the morning's source
  // of truth, and its prompt warms the cache for the questions that follow.
  async execute(now = new Date()): Promise<{ posted: boolean }> {
    const snapshot = await this.refresh.execute(now);
    if (this.config.digestChatId === null) {
      this.logger.log('No digest chat configured; snapshot refreshed only');
      return { posted: false };
    }
    const text = await this.ai.digest({
      brief: this.config.projectBrief,
      snapshot: snapshot.render(),
      question: `${todayLine(
        now,
        this.config.releaseDate,
      )}\n\n${DIGEST_REQUEST}`,
    });
    await this.telegram.sendMessage(this.config.digestChatId, text);
    return { posted: true };
  }
}
