import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PmCronHttpModule } from '@infrastructure/http/project-manager/pm-cron.module';
import { TelegramHttpModule } from '@infrastructure/http/telegram/telegram.module';
import { PmCronController } from '@infrastructure/http/project-manager/pm-cron.controller';
import { PmKnowledgeController } from '@infrastructure/http/project-manager/pm-knowledge.controller';
import { TelegramController } from '@infrastructure/http/telegram/telegram.controller';

// Builds the real module graph with only the Mongo models stubbed, so a
// provider that is not exported or not injectable fails here instead of
// failing the production boot.
const MODELS = [
  'ProjectSnapshot',
  'PmChat',
  'PmKnowledge',
  'PmAction',
  'TelegramMessage',
  'TelegramUpdate',
];

describe('project-manager module wiring', () => {
  it('resolves every controller and provider without a database', async () => {
    let builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true }),
        PmCronHttpModule,
        TelegramHttpModule,
      ],
    });
    for (const name of MODELS) {
      builder = builder.overrideProvider(getModelToken(name)).useValue({});
    }
    const moduleRef = await builder.compile();
    expect(moduleRef.get(PmCronController)).toBeDefined();
    expect(moduleRef.get(PmKnowledgeController)).toBeDefined();
    expect(moduleRef.get(TelegramController)).toBeDefined();
    await moduleRef.close();
  });
});
