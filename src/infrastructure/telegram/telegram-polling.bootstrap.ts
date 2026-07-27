import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  ITelegramConfig,
  TELEGRAM_CONFIG,
} from '@application/telegram/telegram.config.interface';
import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { TelegramBotService } from '@infrastructure/telegram/telegram-bot.service';
import { mapToIncoming } from '@infrastructure/telegram/incoming-message.mapper';

@Injectable()
export class TelegramPollingBootstrap implements OnModuleInit {
  private readonly logger = new Logger(TelegramPollingBootstrap.name);

  constructor(
    private readonly botService: TelegramBotService,
    private readonly handleTelegramMessage: HandleTelegramMessageUseCase,
    @Inject(TELEGRAM_CONFIG) private readonly config: ITelegramConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.mode !== 'polling') return;

    this.botService.bot.on('message', (msg) => {
      const incoming = mapToIncoming(msg);
      if (!incoming) return;
      this.handleTelegramMessage
        .execute(incoming)
        .catch((error) => this.logger.error(error));
    });

    await this.botService.startPolling();
    this.logger.log('Telegram bot polling started');
  }
}
