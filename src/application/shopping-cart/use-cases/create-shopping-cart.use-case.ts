import { Inject, Injectable } from '@nestjs/common';
import {
  IShoppingCartRepository,
  SHOPPING_CART_REPOSITORY,
} from '../../../domain/shopping-cart/shopping-cart.repository.interface';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../../domain/user/user.repository.interface';
import { ShoppingCart } from '../../../domain/shopping-cart/shopping-cart.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CreateShoppingCartUseCase {
  constructor(
    @Inject(SHOPPING_CART_REPOSITORY)
    private readonly cartRepository: IShoppingCartRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(email: string): Promise<ShoppingCart> {
    const id = uuidv4();
    const cart = await this.cartRepository.create(id);
    const user = await this.userRepository.findByEmail(email);
    await this.userRepository.updateShoppingCart(user.id, cart.id);
    return cart;
  }
}
