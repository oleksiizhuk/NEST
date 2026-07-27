import { Module } from '@nestjs/common';
import { TelegramController } from '@infrastructure/http/telegram/telegram.controller';
import { TelegramWebhookGuard } from '@infrastructure/http/telegram/guards/telegram-webhook.guard';
import { TelegramInfraModule } from '@infrastructure/telegram/telegram.module';

@Module({
  imports: [TelegramInfraModule],
  controllers: [TelegramController],
  providers: [TelegramWebhookGuard],
})
export class TelegramHttpModule {}
