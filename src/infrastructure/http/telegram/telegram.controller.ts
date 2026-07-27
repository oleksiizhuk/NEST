import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import TelegramBot = require('node-telegram-bot-api');
import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { mapToIncoming } from '@infrastructure/telegram/incoming-message.mapper';
import { TelegramWebhookGuard } from '@infrastructure/http/telegram/guards/telegram-webhook.guard';

@ApiTags('telegram')
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly handleTelegramMessage: HandleTelegramMessageUseCase,
  ) {}

  @Post('webhook')
  @UseGuards(TelegramWebhookGuard)
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(@Body() update: TelegramBot.Update): Promise<{ ok: boolean }> {
    // Awaited on purpose: on serverless the response must not be sent
    // before the reply and the Mongo write complete
    const message = update?.message;
    if (message) {
      const incoming = mapToIncoming(message);
      if (incoming) await this.handleTelegramMessage.execute(incoming);
    }
    return { ok: true };
  }
}
