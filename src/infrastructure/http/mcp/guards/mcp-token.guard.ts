import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

// The endpoint turns every call into a paid Anthropic request, so it is
// closed unless the caller presents the shared MCP_TOKEN. No token
// configured means the endpoint is closed, not open.
@Injectable()
export class McpTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const secret = this.configService.get<string>('MCP_TOKEN');

    if (!secret || typeof header !== 'string') {
      throw new UnauthorizedException();
    }

    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException();
    }

    const received = Buffer.from(token);
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
