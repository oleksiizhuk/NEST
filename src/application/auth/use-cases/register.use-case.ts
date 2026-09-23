import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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

export interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  age: number;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: IPasswordHasher,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: ITokenService,
  ) {}

  async execute(dto: RegisterDto): Promise<{ user: PublicUser } & AuthTokens> {
    const email = dto.email.toLowerCase();
    if (await this.userRepository.findByEmail(email)) {
      throw new BadRequestException(
        `This email ${dto.email} is already exists`,
      );
    }

    const user = await this.userRepository.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      age: dto.age,
      email,
      password: await this.passwordHasher.hash(dto.password),
      shoppingCartId: null,
    });

    return {
      user: user.toPublicProfile(),
      ...this.tokenService.issue({ userId: user.id, email: user.email }),
    };
  }
}
