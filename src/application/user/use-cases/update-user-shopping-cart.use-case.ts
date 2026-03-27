import { Inject, Injectable } from '@nestjs/common';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';

@Injectable()
export class UpdateUserShoppingCartUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(userId: string, cartId: string | null): Promise<User> {
    return this.userRepository.updateShoppingCart(userId, cartId);
  }
}
