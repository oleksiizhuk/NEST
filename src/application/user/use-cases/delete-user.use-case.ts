import { Inject, Injectable } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { assertAccountOwner } from '@application/user/assert-account-owner';

@Injectable()
export class DeleteUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(requesterEmail: string, id: string): Promise<void> {
    await assertAccountOwner(this.userRepository, requesterEmail, id);
    await this.userRepository.delete(id);
  }
}
