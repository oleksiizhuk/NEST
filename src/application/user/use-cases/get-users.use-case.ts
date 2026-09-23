import { Inject, Injectable } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { PublicUser } from '@domain/user/user.entity';

@Injectable()
export class GetUsersUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(): Promise<PublicUser[]> {
    const users = await this.userRepository.findAll();
    return users.map((user) => user.toPublicProfile());
  }
}
