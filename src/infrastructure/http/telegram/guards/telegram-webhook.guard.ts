import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import {
  ITelegramConfig,
  TELEGRAM_CONFIG,
} from '@application/telegram/telegram.config.interface';

@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  constructor(
    @Inject(TELEGRAM_CONFIG) private readonly config: ITelegramConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-telegram-bot-api-secret-token'];
    const secret = this.config.webhookSecret;

    if (!secret || typeof header !== 'string') {
      throw new UnauthorizedException();
    }

    const received = Buffer.from(header);
    const expected = Buffer.from(secret);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
