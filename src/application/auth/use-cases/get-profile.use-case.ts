import { Inject, Injectable } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';

@Injectable()
export class GetProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(
    email: string,
  ): Promise<Omit<User, 'password' | 'toPublicProfile'>> {
    const user = await this.userRepository.findByEmail(email.toLowerCase());
    return user.toPublicProfile();
  }
}
