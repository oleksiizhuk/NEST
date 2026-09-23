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
import { pmConfig } from '@infrastructure/project-manager/pm.config';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'ProjectSnapshot', schema: ProjectSnapshotSchema },
    ]),
  ],
  providers: [
    { provide: PM_CONFIG, useFactory: pmConfig, inject: [ConfigService] },
    JiraIssueReader,
    ConfluencePageReader,
    GitHubActivityReader,
    {
      provide: PROJECT_SOURCES,
      useFactory: (
        issues: JiraIssueReader,
        docs: ConfluencePageReader,
        code: GitHubActivityReader,
      ) => [issues, docs, code],
      inject: [JiraIssueReader, ConfluencePageReader, GitHubActivityReader],
    },
    {
      provide: PROJECT_SNAPSHOT_REPOSITORY,
      useClass: MongoProjectSnapshotRepository,
    },
    { provide: PM_AI_SERVICE, useClass: AnthropicProjectManagerService },
    RefreshProjectSnapshotUseCase,
    AnswerProjectQuestionUseCase,
  ],
  exports: [
    PM_CONFIG,
    PM_AI_SERVICE,
    RefreshProjectSnapshotUseCase,
    AnswerProjectQuestionUseCase,
  ],
})
export class ProjectManagerModule {}
