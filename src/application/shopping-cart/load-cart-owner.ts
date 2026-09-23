import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IUserRepository } from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';

export async function findUserOrThrow(
  userRepository: IUserRepository,
  email: string,
): Promise<User> {
  const user = await userRepository.findByEmail(email.toLowerCase());
  if (!user) {
    throw new NotFoundException('User not found');
  }
  return user;
}

export async function findCartOwnerOrThrow(
  userRepository: IUserRepository,
  email: string,
): Promise<User & { shoppingCartId: string }> {
  const user = await findUserOrThrow(userRepository, email);
  if (!user.shoppingCartId) {
    throw new BadRequestException('shoppingCart is null');
  }
  return user as User & { shoppingCartId: string };
}
