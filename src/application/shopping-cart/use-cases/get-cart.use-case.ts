import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IShoppingCartRepository,
  SHOPPING_CART_REPOSITORY,
} from '@domain/shopping-cart/shopping-cart.repository.interface';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';
import { findCartOwnerOrThrow } from '@application/shopping-cart/load-cart-owner';

@Injectable()
export class GetCartUseCase {
  constructor(
    @Inject(SHOPPING_CART_REPOSITORY)
    private readonly cartRepository: IShoppingCartRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(email: string): Promise<ShoppingCart> {
    const user = await findCartOwnerOrThrow(this.userRepository, email);
    const cart = await this.cartRepository.findById(user.shoppingCartId);
    if (!cart) {
      throw new NotFoundException('Shopping cart not found');
    }
    return cart;
  }
}
