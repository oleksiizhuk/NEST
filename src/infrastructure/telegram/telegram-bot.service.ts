import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot = require('node-telegram-bot-api');
import {
  IBotInfo,
  ITelegramGateway,
} from '@application/telegram/telegram.gateway.interface';

@Injectable()
export class TelegramBotService implements ITelegramGateway, OnModuleDestroy {
  readonly bot: TelegramBot;
  private botInfo: Promise<IBotInfo> | null = null;
  private pollingStarted = false;

  constructor(configService: ConfigService) {
    // polling: false — no I/O in the constructor, safe for serverless cold starts
    this.bot = new TelegramBot(
      configService.get<string>('TELEGRAM_TOKEN') ?? '',
      { polling: false },
    );
  }

  getBotInfo(): Promise<IBotInfo> {
    if (!this.botInfo) {
      this.botInfo = this.bot
        .getMe()
        .then((me) => ({ id: me.id, username: me.username ?? '' }))
        .catch((error) => {
          this.botInfo = null;
          throw error;
        });
    }
    return this.botInfo;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.bot.sendMessage(chatId, text);
  }

  async sendTyping(chatId: number): Promise<void> {
    await this.bot.sendChatAction(chatId, 'typing');
  }

  async startPolling(): Promise<void> {
    this.pollingStarted = true;
    await this.bot.startPolling();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollingStarted) {
      await this.bot.stopPolling();
    }
  }
}
