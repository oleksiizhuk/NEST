import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { JobWatchHttpModule } from '@infrastructure/http/job-watch/job-watch.module';
import { JobWatchCronController } from '@infrastructure/http/job-watch/job-watch-cron.controller';

// The real module graph with only the Mongo models stubbed, so a missing
// export fails here instead of failing the production boot
const MODELS = [
  'JobWatchSeen',
  'ProjectSnapshot',
  'PmChat',
  'PmKnowledge',
  'PmAction',
  'TelegramMessage',
  'TelegramUpdate',
  'PmMemory',
  'PmAlert',
  'PmGolden',
  'PmQuota',
  'PmSettings',
  'PmAdminLogin',
  'PmAdminAttempt',
  'PmAdminApproval',
  'PmTeamReview',
  'PmTeamDay',
  'PmIndex',
  'PmIndexJob',
  'PmAdminTopic',
  'PmAdminTopicDay',
  'PmAudit',
  'PmProposal',
];

describe('job-watch module wiring', () => {
  it('resolves the controller without a database', async () => {
    let builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true }),
        JobWatchHttpModule,
      ],
    });
    for (const name of MODELS) {
      builder = builder.overrideProvider(getModelToken(name)).useValue({});
    }
    const moduleRef = await builder.compile();
    expect(moduleRef.get(JobWatchCronController)).toBeDefined();
  });
});
