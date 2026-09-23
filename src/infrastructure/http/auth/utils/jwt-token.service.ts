import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthTokens,
  ITokenService,
  TokenSubject,
} from '@application/auth/token-service.interface';
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
} from '@infrastructure/http/auth/constants/constants';

export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string;
  email: string;
  typ: TokenType;
}

@Injectable()
export class JwtTokenService implements ITokenService {
  constructor(private readonly jwtService: JwtService) {}

  issue({ userId, email }: TokenSubject): AuthTokens {
    const access: JwtPayload = { sub: userId, email, typ: 'access' };
    const refresh: JwtPayload = { sub: userId, email, typ: 'refresh' };
    return {
      accessToken: this.jwtService.sign(access, {
        expiresIn: ACCESS_TOKEN_TTL,
      }),
      refreshToken: this.jwtService.sign(refresh, {
        expiresIn: REFRESH_TOKEN_TTL,
      }),
    };
  }

  verifyRefresh(token: string): TokenSubject | null {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      return payload.typ === 'refresh' && payload.sub && payload.email
        ? { userId: payload.sub, email: payload.email }
        : null;
    } catch {
      return null;
    }
  }
}
