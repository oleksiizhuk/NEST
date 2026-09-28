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
// Bearer <secret> against the configured secret, in constant time. No
// secret configured means closed, not open.
export const bearerMatches = (header: unknown, secret?: string): boolean => {
  if (!secret || typeof header !== 'string') return false;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  const received = Buffer.from(token);
  const expected = Buffer.from(secret);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
};

@Injectable()
export class McpTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !bearerMatches(
        request.headers.authorization,
        this.configService.get<string>('MCP_TOKEN'),
      )
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

// GET /mcp/stats shows every client's tasks: it takes the owner's own
// MCP_STATS_TOKEN, never an IDE's MCP_TOKEN. Unset = closed.
@Injectable()
export class McpStatsTokenGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secret = this.configService.get<string>('MCP_STATS_TOKEN');
    // The same value as the IDE token would hand IDEs the stats again
    if (secret && secret === this.configService.get<string>('MCP_TOKEN')) {
      throw new UnauthorizedException();
    }
    if (!bearerMatches(request.headers.authorization, secret)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
