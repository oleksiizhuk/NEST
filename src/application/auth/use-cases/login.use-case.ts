import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { PublicUser } from '@domain/user/user.entity';
import {
  IPasswordHasher,
  PASSWORD_HASHER,
} from '@application/auth/password-hasher.interface';
import {
  AuthTokens,
  ITokenService,
  TOKEN_SERVICE,
} from '@application/auth/token-service.interface';

export interface LoginDto {
  email: string;
  password: string;
}

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: IPasswordHasher,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
  ) {}

  async execute(dto: LoginDto): Promise<{ user: PublicUser } & AuthTokens> {
    const user = await this.userRepository.findByEmail(dto.email.toLowerCase());
    // verify() still runs a bcrypt compare for an unknown email, so the
    // response time doesn't reveal which emails are registered.
    const valid = await this.passwordHasher.verify(
      dto.password,
      user?.password ?? '',
    );
    if (!user || !valid) {
      throw new UnauthorizedException('invalid credential');
    }

    // Accounts created before hashing still hold the plain password;
    // replace it with a hash on the first successful login.
    if (this.passwordHasher.isLegacy(user.password)) {
      await this.userRepository.update(user.id, {
        password: await this.passwordHasher.hash(dto.password),
      });
    }

    return {
      user: user.toPublicProfile(),
      ...this.tokenService.issue({ userId: user.id, email: user.email }),
    };
  }
}
