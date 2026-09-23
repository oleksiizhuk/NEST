import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IUserRepository } from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';

// A user may change or remove only their own account.
export async function assertAccountOwner(
  userRepository: IUserRepository,
  requesterEmail: string,
  targetId: string,
): Promise<User> {
  const requester = await userRepository.findByEmail(
    requesterEmail.toLowerCase(),
  );
  if (!requester) {
    throw new NotFoundException('User not found');
  }
  if (requester.id !== targetId) {
    throw new ForbiddenException('You can only modify your own account');
  }
  return requester;
}
