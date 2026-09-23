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

export interface CreateUserDto {
  firstName: string;
  lastName: string;
  age: number;
  email: string;
  password: string;
}

@Injectable()
export class CreateUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: IPasswordHasher,
  ) {}

  async execute(dto: CreateUserDto): Promise<PublicUser> {
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
    return user.toPublicProfile();
  }
}
