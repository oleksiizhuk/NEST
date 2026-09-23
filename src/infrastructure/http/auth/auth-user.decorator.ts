import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '@infrastructure/http/auth/strategies/jwt.strategy';

// The email of the caller, set by JwtStrategy on routes behind JwtAuthGuard.
export const CurrentUserEmail = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    (ctx.switchToHttp().getRequest().user as AuthUser).email,
);
