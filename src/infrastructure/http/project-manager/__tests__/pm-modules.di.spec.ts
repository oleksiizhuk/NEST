import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PmCronHttpModule } from '@infrastructure/http/project-manager/pm-cron.module';
import { TelegramHttpModule } from '@infrastructure/http/telegram/telegram.module';
import { PmCronController } from '@infrastructure/http/project-manager/pm-cron.controller';
import { PmKnowledgeController } from '@infrastructure/http/project-manager/pm-knowledge.controller';
import { TelegramController } from '@infrastructure/http/telegram/telegram.controller';
import { PostDailyDigestUseCase } from '@application/project-manager/use-cases/post-daily-digest.use-case';
import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';

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
    // Optional dependencies resolve to undefined when a module forgets to
    // export them; the features behind them would then be silently off
    const optional = (instance: object, field: string) =>
      (instance as Record<string, unknown>)[field];
    expect(
      optional(moduleRef.get(PostDailyDigestUseCase), 'snapshots'),
    ).toBeDefined();
    const handler = moduleRef.get(HandleTelegramMessageUseCase);
    for (const field of [
      'pmConfig',
      'pmAnswer',
      'pmRefresh',
      'pmChats',
      'pmConfirm',
    ]) {
      expect(optional(handler, field)).toBeDefined();
    }
    await moduleRef.close();
  });
});
