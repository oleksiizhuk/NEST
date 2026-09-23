import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { getJwtSecret } from '@infrastructure/http/auth/constants/constants';
import { JwtPayload } from '@infrastructure/http/auth/utils/jwt-token.service';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';

export interface AuthUser {
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  // Only access tokens open protected routes, and only while the account
  // they were issued to still holds that email: after an email change or a
  // deletion, a new owner of the address never inherits old tokens.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload?.typ !== 'access' || !payload.sub || !payload.email) {
      throw new UnauthorizedException();
    }
    const user = await this.userRepository.findByEmail(payload.email);
    if (!user || user.id !== payload.sub) {
      throw new UnauthorizedException();
    }
    return { email: user.email };
  }
}
