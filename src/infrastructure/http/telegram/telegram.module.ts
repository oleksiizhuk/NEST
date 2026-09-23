import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TELEGRAM_UPDATE_REGISTRY } from '@application/telegram/telegram-update-registry.interface';
import { TelegramUpdateSchema } from '@infrastructure/database/schemas/telegram-update.schema';
import { MongoTelegramUpdateRegistry } from '@infrastructure/database/repositories/mongo-telegram-update.repository';
import { TelegramController } from '@infrastructure/http/telegram/telegram.controller';
import { TelegramWebhookGuard } from '@infrastructure/http/telegram/guards/telegram-webhook.guard';
import { TelegramInfraModule } from '@infrastructure/telegram/telegram.module';

@Module({
  imports: [
    TelegramInfraModule,
    MongooseModule.forFeature([
      { name: 'TelegramUpdate', schema: TelegramUpdateSchema },
    ]),
  ],
  controllers: [TelegramController],
  providers: [
    TelegramWebhookGuard,
    {
      provide: TELEGRAM_UPDATE_REGISTRY,
      useClass: MongoTelegramUpdateRegistry,
    },
  ],
})
export class TelegramHttpModule {}
