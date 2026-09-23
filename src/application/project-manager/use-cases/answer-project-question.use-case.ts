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
import {
  IKnowledgeStore,
  PM_KNOWLEDGE,
} from '@application/project-manager/knowledge.interface';
import {
  CODE_HOST,
  ICodeHost,
} from '@application/project-manager/code-host.interface';
import {
  IStagingAdmin,
  STAGING_ADMIN,
} from '@application/project-manager/staging-admin.interface';
import {
  IPendingActions,
  PENDING_ACTIONS,
  PendingAction,
} from '@application/project-manager/pending-action.interface';
import {
  PmToolbox,
  ToolContext,
} from '@application/project-manager/tools/pm-toolbox';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { todayLine } from '@application/project-manager/release-clock';

export interface PmAnswer {
  text: string;
  proposal: PendingAction | null;
}

export const renderKnowledge = async (
  store: IKnowledgeStore,
): Promise<string> =>
  (await store.all().catch(() => []))
    .map((doc) => `<doc key="${doc.key}">\n${doc.text}\n</doc>`)
    .join('\n');

@Injectable()
export class AnswerProjectQuestionUseCase {
  constructor(
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IProjectSnapshotRepository,
    private readonly refresh: RefreshProjectSnapshotUseCase,
    @Inject(PM_AI_SERVICE) private readonly ai: IProjectManagerAiService,
    @Inject(PM_CONFIG) private readonly config: IPmConfig,
    @Inject(PM_KNOWLEDGE) private readonly knowledge: IKnowledgeStore,
    @Inject(CODE_HOST) private readonly code: ICodeHost,
    @Inject(STAGING_ADMIN) private readonly staging: IStagingAdmin,
    @Inject(PENDING_ACTIONS) private readonly actions: IPendingActions,
  ) {}

  async execute(
    question: string,
    history: PmTurn[],
    chat: { chatId: number; requesterId: number } = {
      chatId: 0,
      requesterId: 0,
    },
    now = new Date(),
    deadline?: number,
  ): Promise<PmAnswer> {
    const [snapshot, knowledge] = await Promise.all([
      this.currentSnapshot(now),
      renderKnowledge(this.knowledge),
    ]);
    const toolbox = new PmToolbox(this.code, this.staging, this.actions);
    const ctx: ToolContext = { ...chat, proposal: null };
    const text = await this.ai.answer({
      brief: this.config.projectBrief,
      knowledge,
      snapshot: snapshot.render(),
      history,
      question: `${todayLine(now, this.config.releaseDate)}\n\n${question}`,
      tools: {
        specs: toolbox.specs(),
        run: (name, input) => toolbox.run(name, input, ctx),
      },
      deadline,
    });
    return { text, proposal: ctx.proposal };
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
