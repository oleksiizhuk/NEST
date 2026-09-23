import { Inject, Injectable } from '@nestjs/common';
import {
  IProjectSnapshotRepository,
  PROJECT_SNAPSHOT_REPOSITORY,
} from '@domain/project-status/project-snapshot.repository.interface';
import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import {
  IProjectManagerAiService,
  PM_AI_SERVICE,
  PmTurn,
} from '@application/project-manager/project-manager-ai.interface';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { todayLine } from '@application/project-manager/release-clock';

@Injectable()
export class AnswerProjectQuestionUseCase {
  constructor(
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IProjectSnapshotRepository,
    private readonly refresh: RefreshProjectSnapshotUseCase,
    @Inject(PM_AI_SERVICE) private readonly ai: IProjectManagerAiService,
    @Inject(PM_CONFIG) private readonly config: IPmConfig,
  ) {}

  async execute(
    question: string,
    history: PmTurn[],
    now = new Date(),
  ): Promise<string> {
    const snapshot = await this.currentSnapshot(now);
    return this.ai.answer({
      brief: this.config.projectBrief,
      snapshot: snapshot.render(),
      history,
      question: `${todayLine(now, this.config.releaseDate)}\n\n${question}`,
    });
  }

  // The daily cron keeps it fresh; this covers a missed cron or a first run.
  private async currentSnapshot(now: Date): Promise<ProjectSnapshot> {
    const latest = await this.snapshots.findLatest();
    if (latest && !latest.isOlderThan(now, this.config.maxSnapshotAgeHours)) {
      return latest;
    }
    return this.refresh.execute(now);
  }
}
