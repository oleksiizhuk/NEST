import { Injectable } from '@nestjs/common';
import { UserDto } from './dto/user.dto';
import { IUser } from './interfaces/user.interfaces';
import { UserRepository } from './user.repository';
import { LogMethodCallAndReturn } from '../../decorator/logMethodCallAndReturn';

@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async getUsers(): Promise<IUser[]> {
    return this.userRepository.getUsers();
  }

  @LogMethodCallAndReturn()
  async createUser(user: UserDto): Promise<IUser> {
    return this.userRepository.createUser(user);
  }

  async getUserById(id: string): Promise<IUser> {
    return this.userRepository.getUserById(id);
  }

  async getUserByEmail(email: string): Promise<IUser> {
    return this.userRepository.getUserByEmail(email.toLowerCase());
  }

  async update(id: string, user: UserDto): Promise<IUser> {
    return this.userRepository.update(id, user);
  }

  async delete(id: string): Promise<IUser> {
    return this.userRepository.delete(id);
  }

  async addShoppingShoppingCartToUser(
    id: string,
    shoppingCartID: string,
  ): Promise<IUser> {
    return this.userRepository.addShoppingShoppingCartToUser(
      id,
      shoppingCartID,
    );
  }
}
