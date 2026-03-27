import { User } from '@domain/user/user.entity';

export const USER_REPOSITORY = 'USER_REPOSITORY';

export interface IUserRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: Omit<User, 'id' | 'toPublicProfile'>): Promise<User>;
  update(
    id: string,
    data: Partial<Omit<User, 'id' | 'toPublicProfile'>>,
  ): Promise<User>;
  delete(id: string): Promise<User>;
  updateShoppingCart(userId: string, cartId: string | null): Promise<User>;
}
