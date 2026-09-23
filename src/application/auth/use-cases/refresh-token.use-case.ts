import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AuthTokens,
  ITokenService,
  TOKEN_SERVICE,
} from '@application/auth/token-service.interface';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';

@Injectable()
export class RefreshTokenUseCase {
  constructor(
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(refreshToken: string | undefined): Promise<AuthTokens> {
    const subject = refreshToken
      ? this.tokenService.verifyRefresh(refreshToken)
      : null;
    const user = subject
      ? await this.userRepository.findByEmail(subject.email)
      : null;
    if (!user || user.id !== subject.userId) {
      throw new UnauthorizedException('Token is invalid');
    }
    return this.tokenService.issue({ userId: user.id, email: user.email });
  }
}
