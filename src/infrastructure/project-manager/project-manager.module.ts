import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PM_CONFIG } from '@application/project-manager/pm.config.interface';
import { PROJECT_SOURCES } from '@application/project-manager/project-source.interface';
import { PM_AI_SERVICE } from '@application/project-manager/project-manager-ai.interface';
import { PROJECT_SNAPSHOT_REPOSITORY } from '@domain/project-status/project-snapshot.repository.interface';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { AnswerProjectQuestionUseCase } from '@application/project-manager/use-cases/answer-project-question.use-case';
import { ProjectSnapshotSchema } from '@infrastructure/database/schemas/project-snapshot.schema';
import { MongoProjectSnapshotRepository } from '@infrastructure/database/repositories/mongo-project-snapshot.repository';
import { AnthropicProjectManagerService } from '@infrastructure/anthropic/anthropic-project-manager.service';
import { JiraIssueReader } from '@infrastructure/project-manager/jira-issue.reader';
import { ConfluencePageReader } from '@infrastructure/project-manager/confluence-page.reader';
import { GitHubActivityReader } from '@infrastructure/project-manager/github-activity.reader';
import { FigmaActivityReader } from '@infrastructure/project-manager/figma-activity.reader';
import { pmConfig } from '@infrastructure/project-manager/pm.config';
import { PM_KNOWLEDGE } from '@application/project-manager/knowledge.interface';
import { CODE_HOST } from '@application/project-manager/code-host.interface';
import { ADMIN_TARGETS } from '@application/project-manager/staging-admin.interface';
import { PENDING_ACTIONS } from '@application/project-manager/pending-action.interface';
import { ConfirmPendingActionUseCase } from '@application/project-manager/use-cases/confirm-pending-action.use-case';
import { PmKnowledgeSchema } from '@infrastructure/database/schemas/pm-knowledge.schema';
import { MongoPmKnowledgeStore } from '@infrastructure/database/repositories/mongo-pm-knowledge.store';
import { PmActionSchema } from '@infrastructure/database/schemas/pm-action.schema';
import { MongoPendingActions } from '@infrastructure/database/repositories/mongo-pending-actions';
import { GitHubCodeHost } from '@infrastructure/project-manager/github-code.host';
import { AdminTargets } from '@infrastructure/staging-admin/http-staging-admin';
import {
  DESIGN_HOST,
  DOC_COMMENTS,
  DOC_SEARCH,
  ISSUE_DETAILS,
} from '@application/project-manager/collaboration.interface';
import { JiraIssueDetails } from '@infrastructure/project-manager/jira-issue-details';
import { ConfluenceCommentsReader } from '@infrastructure/project-manager/confluence-comments.reader';
import { ConfluenceSearch } from '@infrastructure/project-manager/confluence-search';
import { PM_MEMORY } from '@application/project-manager/memory.interface';
import { PM_ALERT_LOG } from '@application/project-manager/alert-log.interface';
import { PM_GOLDEN } from '@application/project-manager/golden.interface';
import { MongoPmMemory } from '@infrastructure/database/repositories/mongo-pm-memory';
import { MongoAlertLog } from '@infrastructure/database/repositories/mongo-alert-log';
import { MongoGoldenStore } from '@infrastructure/database/repositories/mongo-golden-store';
import { PmMemorySchema } from '@infrastructure/database/schemas/pm-memory.schema';
import { PmAlertSchema } from '@infrastructure/database/schemas/pm-alert.schema';
import { PmGoldenSchema } from '@infrastructure/database/schemas/pm-golden.schema';
import { PM_QUOTA } from '@application/project-manager/quota.interface';
import { MongoQuota } from '@infrastructure/database/repositories/mongo-quota';
import { PmQuotaSchema } from '@infrastructure/database/schemas/pm-quota.schema';
import { PM_SETTINGS } from '@application/project-manager/settings.interface';
import { PM_ADMIN_LINKS } from '@application/project-manager/admin-links.interface';
import { PmRuntimeConfig } from '@application/project-manager/pm-runtime-config';
import { MongoPmSettings } from '@infrastructure/database/repositories/mongo-pm-settings';
import { MongoAdminLinks } from '@infrastructure/project-manager/admin-links';
import { PM_ADMIN_APPROVALS } from '@application/project-manager/admin-approvals.interface';
import { MongoAdminApprovals } from '@infrastructure/project-manager/admin-approvals';
import { PM_TEAM_REVIEWS } from '@application/project-manager/team-reviews.interface';
import { MongoTeamReviews } from '@infrastructure/database/repositories/mongo-team-reviews';
import { PmTeamReviewSchema } from '@infrastructure/database/schemas/pm-team-review.schema';
import {
  PM_INDEX,
  PM_INDEX_JOB,
  PM_INDEX_READERS,
} from '@application/project-manager/project-index.interface';
import {
  MongoIndexJob,
  MongoProjectIndex,
} from '@infrastructure/database/repositories/mongo-project-index';
import {
  PmIndexJobSchema,
  PmIndexSchema,
} from '@infrastructure/database/schemas/pm-index.schema';
import {
  ConfluenceIndexReader,
  FigmaIndexReader,
  GitHubIndexReader,
  JiraIndexReader,
} from '@infrastructure/project-manager/index-readers';
import { BuildIndexUseCase } from '@application/project-manager/use-cases/build-index.use-case';
import { PmAdminApprovalSchema } from '@infrastructure/database/schemas/pm-admin-approval.schema';
import { PmSettingsSchema } from '@infrastructure/database/schemas/pm-settings.schema';
import { PmAdminLoginSchema } from '@infrastructure/database/schemas/pm-admin-login.schema';
import { FigmaDesignHost } from '@infrastructure/project-manager/figma-design.host';
import { PM_CHAT_REGISTRY } from '@application/project-manager/pm-chat-registry.interface';
import { PmChatSchema } from '@infrastructure/database/schemas/pm-chat.schema';
import { MongoPmChatRegistry } from '@infrastructure/database/repositories/mongo-pm-chat.registry';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'ProjectSnapshot', schema: ProjectSnapshotSchema },
      { name: 'PmChat', schema: PmChatSchema },
      { name: 'PmKnowledge', schema: PmKnowledgeSchema },
      { name: 'PmAction', schema: PmActionSchema },
      { name: 'PmMemory', schema: PmMemorySchema },
      { name: 'PmAlert', schema: PmAlertSchema },
      { name: 'PmGolden', schema: PmGoldenSchema },
      { name: 'PmQuota', schema: PmQuotaSchema },
      { name: 'PmSettings', schema: PmSettingsSchema },
      { name: 'PmAdminLogin', schema: PmAdminLoginSchema },
      { name: 'PmAdminApproval', schema: PmAdminApprovalSchema },
      { name: 'PmTeamReview', schema: PmTeamReviewSchema },
      { name: 'PmIndex', schema: PmIndexSchema },
      { name: 'PmIndexJob', schema: PmIndexJobSchema },
    ]),
  ],
  providers: [
    { provide: PM_CONFIG, useFactory: pmConfig, inject: [ConfigService] },
    JiraIssueReader,
    ConfluencePageReader,
    GitHubActivityReader,
    FigmaActivityReader,
    {
      provide: PROJECT_SOURCES,
      useFactory: (
        issues: JiraIssueReader,
        docs: ConfluencePageReader,
        code: GitHubActivityReader,
        design: FigmaActivityReader,
      ) => [issues, docs, code, design],
      inject: [
        JiraIssueReader,
        ConfluencePageReader,
        GitHubActivityReader,
        FigmaActivityReader,
      ],
    },
    {
      provide: PROJECT_SNAPSHOT_REPOSITORY,
      useClass: MongoProjectSnapshotRepository,
    },
    { provide: PM_AI_SERVICE, useClass: AnthropicProjectManagerService },
    { provide: PM_CHAT_REGISTRY, useClass: MongoPmChatRegistry },
    { provide: PM_KNOWLEDGE, useClass: MongoPmKnowledgeStore },
    { provide: CODE_HOST, useClass: GitHubCodeHost },
    {
      provide: ADMIN_TARGETS,
      useFactory: (config: ConfigService) => new AdminTargets(config),
      inject: [ConfigService],
    },
    { provide: PENDING_ACTIONS, useClass: MongoPendingActions },
    { provide: ISSUE_DETAILS, useClass: JiraIssueDetails },
    { provide: DOC_COMMENTS, useClass: ConfluenceCommentsReader },
    { provide: DESIGN_HOST, useClass: FigmaDesignHost },
    { provide: DOC_SEARCH, useClass: ConfluenceSearch },
    { provide: PM_MEMORY, useClass: MongoPmMemory },
    { provide: PM_ALERT_LOG, useClass: MongoAlertLog },
    { provide: PM_GOLDEN, useClass: MongoGoldenStore },
    { provide: PM_QUOTA, useClass: MongoQuota },
    { provide: PM_SETTINGS, useClass: MongoPmSettings },
    { provide: PM_ADMIN_LINKS, useClass: MongoAdminLinks },
    { provide: PM_ADMIN_APPROVALS, useClass: MongoAdminApprovals },
    { provide: PM_TEAM_REVIEWS, useClass: MongoTeamReviews },
    { provide: PM_INDEX, useClass: MongoProjectIndex },
    { provide: PM_INDEX_JOB, useClass: MongoIndexJob },
    JiraIndexReader,
    ConfluenceIndexReader,
    FigmaIndexReader,
    GitHubIndexReader,
    {
      provide: PM_INDEX_READERS,
      useFactory: (
        jira: JiraIndexReader,
        docs: ConfluenceIndexReader,
        design: FigmaIndexReader,
        code: GitHubIndexReader,
      ) => [jira, docs, design, code],
      inject: [
        JiraIndexReader,
        ConfluenceIndexReader,
        FigmaIndexReader,
        GitHubIndexReader,
      ],
    },
    BuildIndexUseCase,
    PmRuntimeConfig,
    ConfirmPendingActionUseCase,
    RefreshProjectSnapshotUseCase,
    AnswerProjectQuestionUseCase,
  ],
  exports: [
    PM_CONFIG,
    PROJECT_SNAPSHOT_REPOSITORY,
    PM_MEMORY,
    PM_ALERT_LOG,
    PM_GOLDEN,
    PM_QUOTA,
    PM_SETTINGS,
    PM_ADMIN_LINKS,
    PM_ADMIN_APPROVALS,
    PM_TEAM_REVIEWS,
    PM_INDEX,
    BuildIndexUseCase,
    PmRuntimeConfig,
    ISSUE_DETAILS,
    DOC_COMMENTS,
    DESIGN_HOST,
    PENDING_ACTIONS,
    ADMIN_TARGETS,
    PM_KNOWLEDGE,
    ConfirmPendingActionUseCase,
    PM_CHAT_REGISTRY,
    PM_AI_SERVICE,
    RefreshProjectSnapshotUseCase,
    AnswerProjectQuestionUseCase,
  ],
})
export class ProjectManagerModule {}
