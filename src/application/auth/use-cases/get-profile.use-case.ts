import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { PublicUser } from '@domain/user/user.entity';

@Injectable()
export class GetProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(email: string): Promise<PublicUser> {
    const user = await this.userRepository.findByEmail(email.toLowerCase());
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.toPublicProfile();
  }
}
