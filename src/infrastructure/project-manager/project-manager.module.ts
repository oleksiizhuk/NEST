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
  ISSUE_DETAILS,
} from '@application/project-manager/collaboration.interface';
import { JiraIssueDetails } from '@infrastructure/project-manager/jira-issue-details';
import { ConfluenceCommentsReader } from '@infrastructure/project-manager/confluence-comments.reader';
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
    ConfirmPendingActionUseCase,
    RefreshProjectSnapshotUseCase,
    AnswerProjectQuestionUseCase,
  ],
  exports: [
    PM_CONFIG,
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
