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
  PmUsage,
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
import { loadKnowledge } from '@application/project-manager/knowledge-loader';
import {
  IPmMemory,
  PM_MEMORY,
  renderMemory,
} from '@application/project-manager/memory.interface';
import { readinessChecklist } from '@application/project-manager/readiness';
import { PmRuntimeConfig } from '@application/project-manager/pm-runtime-config';

const NO_CODE_NOTE =
  'The person asking cannot have code read or PRs reviewed in depth: answer about code and PRs from the snapshot only (PR list, review state, CI), and say the owner can ask for a deep look.';

// Leaves room for sending the reply within the 300 s function limit
const ANSWER_BUDGET_MS = 240_000;

export interface PmAnswer {
  text: string;
  proposal: PendingAction | null;
  // Button labels to attach; ignored when there is a proposal
  choices: string[];
  // What the answer cost; absent when the model service does not report it
  usage?: PmUsage;
}

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
    @Optional()
    @Inject(PM_MEMORY)
    private readonly memory?: IPmMemory,
    @Optional() private readonly runtime?: PmRuntimeConfig,
  ) {}

  async execute(
    question: string,
    history: PmTurn[],
    chat: {
      chatId: number;
      requesterId: number;
      requesterName?: string;
      // Owner-run diagnostics and the eval default to true
      canReadCode?: boolean;
    } = {
      chatId: 0,
      requesterId: 0,
    },
    now = new Date(),
    deadline?: number,
  ): Promise<PmAnswer> {
    // The whole webhook has to finish inside Vercel's limit, so the model's
    // budget counts from here, not from after the snapshot is loaded
    const until = deadline ?? Date.now() + ANSWER_BUDGET_MS;
    const live = await this.runtime?.current().catch(() => undefined);
    const [snapshot, knowledge, memories] = await Promise.all([
      this.currentSnapshot(now),
      loadKnowledge(this.knowledge, this.config.knowledgeInlineChars),
      this.memory?.active(now).catch(() => []) ?? Promise.resolve([]),
    ]);
    const memoryBlock = renderMemory(memories);
    const toolbox = new PmToolbox(this.code, this.targets, this.actions, {
      issues: this.issues,
      docs: this.docs,
      design: this.design,
      search: this.search,
      knowledge: {
        keys: knowledge.onDemand.map((d) => d.key),
        read: async (key) =>
          knowledge.onDemand.find((d) => d.key === key)?.text ?? null,
      },
      memory: Boolean(this.memory),
      readiness: () => readinessChecklist(snapshot, knowledge.doc('core:dod')),
      team: this.config.team,
    });
    const canReadCode = chat.canReadCode ?? true;
    const ctx: ToolContext = { ...chat, canReadCode, proposal: null };
    let usage: PmUsage | undefined;
    const text = await this.ai.answer({
      // Memory rides with the brief: it changes rarely, and this block is
      // after the cached knowledge, so a new record does not evict it
      brief: [knowledge.brief ?? this.config.projectBrief, memoryBlock]
        .filter(Boolean)
        .join('\n\n'),
      knowledge: knowledge.text,
      snapshot: snapshot.render(),
      history,
      // After the cached prefix, so the note does not split the cache
      question: `${todayLine(now, this.config.releaseDate)}${
        canReadCode ? '' : `\n${NO_CODE_NOTE}`
      }\n\n${question}`,
      tools: {
        specs: toolbox.specs(),
        run: (name, input) => toolbox.run(name, input, ctx),
        close: () => {
          ctx.closed = true;
        },
      },
      deadline: until,
      ...(live?.aiEffort ? { effort: live.aiEffort } : {}),
      onUsage: (u) => {
        usage = u;
      },
    });
    return {
      text,
      proposal: ctx.proposal,
      choices: ctx.proposal ? [] : ctx.choices ?? [],
      ...(usage ? { usage } : {}),
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
