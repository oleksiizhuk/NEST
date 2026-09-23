import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. No secret
// configured means the endpoint stays closed.
@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('CRON_SECRET');
    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    if (!secret || typeof header !== 'string') {
      throw new UnauthorizedException();
    }
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(header);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
