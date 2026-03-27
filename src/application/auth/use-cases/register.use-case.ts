import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';
import { JWTGenerator } from '@infrastructure/http/auth/utils/jwt-generator';

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
    private readonly jwtGenerator: JWTGenerator,
  ) {}

  async execute(
    dto: RegisterDto,
  ): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const existing = await this.userRepository.findByEmail(
      dto.email.toLowerCase(),
    );
    if (existing) {
      throw new BadRequestException(
        `This email ${dto.email} is already exists`,
      );
    }

    const user = await this.userRepository.create({
      ...dto,
      email: dto.email.toLowerCase(),
      shoppingCartId: null,
    });

    const { accessToken, refreshToken } = this.jwtGenerator.generateJWT(
      user.email,
    );
    return { user, accessToken, refreshToken };
  }
}
