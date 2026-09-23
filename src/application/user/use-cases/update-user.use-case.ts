import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { PublicUser, User } from '@domain/user/user.entity';
import {
  IPasswordHasher,
  PASSWORD_HASHER,
} from '@application/auth/password-hasher.interface';
import { assertAccountOwner } from '@application/user/assert-account-owner';

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  age?: number;
  email?: string;
  password?: string;
}

@Injectable()
export class UpdateUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: IPasswordHasher,
  ) {}

  async execute(
    requesterEmail: string,
    id: string,
    dto: UpdateUserDto,
  ): Promise<PublicUser> {
    const owner = await assertAccountOwner(
      this.userRepository,
      requesterEmail,
      id,
    );

    const changes: Partial<Omit<User, 'id' | 'toPublicProfile'>> = {};
    if (dto.firstName !== undefined) changes.firstName = dto.firstName;
    if (dto.lastName !== undefined) changes.lastName = dto.lastName;
    if (dto.age !== undefined) changes.age = dto.age;
    if (dto.email !== undefined) {
      const email = dto.email.toLowerCase();
      if (
        email !== owner.email &&
        (await this.userRepository.findByEmail(email))
      ) {
        throw new BadRequestException(
          `This email ${dto.email} is already exists`,
        );
      }
      changes.email = email;
    }
    if (dto.password !== undefined) {
      changes.password = await this.passwordHasher.hash(dto.password);
    }

    const updated = await this.userRepository.update(id, changes);
    return (updated ?? owner).toPublicProfile();
  }
}
