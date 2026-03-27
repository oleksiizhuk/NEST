import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';
import { JWTGenerator } from '../../../infrastructure/http/auth/utils/jwt-generator';

export interface LoginDto {
  email: string;
  password: string;
}

@Injectable()
export class LoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly jwtGenerator: JWTGenerator,
  ) {}

  async execute(
    dto: LoginDto,
  ): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const user = await this.userRepository.findByEmail(dto.email.toLowerCase());
    if (!user || user.password !== dto.password) {
      throw new BadRequestException('invalid credential');
    }

    const { accessToken, refreshToken } = this.jwtGenerator.generateJWT(
      user.email,
    );
    return { user, accessToken, refreshToken };
  }
}
