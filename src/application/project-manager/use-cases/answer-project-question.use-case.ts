import { Inject, Injectable, Optional } from '@nestjs/common';
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
  ADMIN_TARGETS,
  IAdminTargets,
} from '@application/project-manager/staging-admin.interface';
import {
  IPendingActions,
  PENDING_ACTIONS,
  PendingAction,
} from '@application/project-manager/pending-action.interface';
import {
  DESIGN_HOST,
  DOC_COMMENTS,
  DOC_SEARCH,
  IDesignHost,
  IDocComments,
  IDocSearch,
  IIssueDetails,
  ISSUE_DETAILS,
} from '@application/project-manager/collaboration.interface';
import {
  PmToolbox,
  ToolContext,
} from '@application/project-manager/tools/pm-toolbox';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { todayLine } from '@application/project-manager/release-clock';

// Leaves room for sending the reply within the 300 s function limit
const ANSWER_BUDGET_MS = 240_000;

export interface PmAnswer {
  text: string;
  proposal: PendingAction | null;
  // Button labels to attach; ignored when there is a proposal
  choices: string[];
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
    @Inject(ADMIN_TARGETS) private readonly targets: IAdminTargets,
    @Inject(PENDING_ACTIONS) private readonly actions: IPendingActions,
    @Inject(ISSUE_DETAILS) private readonly issues: IIssueDetails,
    @Inject(DOC_COMMENTS) private readonly docs: IDocComments,
    @Inject(DESIGN_HOST) private readonly design: IDesignHost,
    @Optional()
    @Inject(DOC_SEARCH)
    private readonly search?: IDocSearch,
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
    // The whole webhook has to finish inside Vercel's limit, so the model's
    // budget counts from here, not from after the snapshot is loaded
    const until = deadline ?? Date.now() + ANSWER_BUDGET_MS;
    const [snapshot, knowledge] = await Promise.all([
      this.currentSnapshot(now),
      renderKnowledge(this.knowledge),
    ]);
    const toolbox = new PmToolbox(this.code, this.targets, this.actions, {
      issues: this.issues,
      docs: this.docs,
      design: this.design,
      search: this.search,
      team: this.config.team,
    });
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
        close: () => {
          ctx.closed = true;
        },
      },
      deadline: until,
    });
    return {
      text,
      proposal: ctx.proposal,
      choices: ctx.proposal ? [] : ctx.choices ?? [],
    };
  }

  // Crons keep it fresh. A stale snapshot is still used (its date is in the
  // prompt): rebuilding it here could push the webhook past the platform's
  // time limit. Only the very first question builds one inline.
  private async currentSnapshot(now: Date): Promise<ProjectSnapshot> {
    const latest = await this.snapshots.findLatest();
    return latest ?? this.refresh.execute(now);
  }
}
