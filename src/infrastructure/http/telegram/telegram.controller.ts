import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ITelegramUpdateRegistry,
  TELEGRAM_UPDATE_REGISTRY,
} from '@application/telegram/telegram-update-registry.interface';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Update } from 'grammy/types';
import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { mapToIncoming } from '@infrastructure/telegram/incoming-message.mapper';
import { TelegramWebhookGuard } from '@infrastructure/http/telegram/guards/telegram-webhook.guard';

@ApiTags('telegram')
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly handleTelegramMessage: HandleTelegramMessageUseCase,
    @Inject(TELEGRAM_UPDATE_REGISTRY)
    private readonly updates: ITelegramUpdateRegistry,
  ) {}

  @Post('webhook')
  @UseGuards(TelegramWebhookGuard)
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(@Body() update: Update): Promise<{ ok: boolean }> {
    // Awaited on purpose: on serverless the response must not be sent
    // before the reply and the Mongo write complete
    // Telegram resends an update when a slow reply outlives its wait; a
    // second copy must not produce (and bill) a second answer
    if (
      typeof update?.update_id === 'number' &&
      !(await this.updates.claim(update.update_id))
    ) {
      return { ok: true };
    }
    const message = update?.message;
    if (message) {
      const incoming = mapToIncoming(message);
      if (incoming) await this.handleTelegramMessage.execute(incoming);
    }
    return { ok: true };
  }
}
