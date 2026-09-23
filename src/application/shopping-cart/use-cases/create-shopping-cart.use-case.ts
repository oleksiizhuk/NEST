import { Inject, Injectable } from '@nestjs/common';
import {
  IShoppingCartRepository,
  SHOPPING_CART_REPOSITORY,
} from '@domain/shopping-cart/shopping-cart.repository.interface';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';
import { findUserOrThrow } from '@application/shopping-cart/load-cart-owner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CreateShoppingCartUseCase {
  constructor(
    @Inject(SHOPPING_CART_REPOSITORY)
    private readonly cartRepository: IShoppingCartRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  // Idempotent: a user who already has a cart gets that cart back instead
  // of a new one that would orphan the old document.
  async execute(email: string): Promise<ShoppingCart> {
    const user = await findUserOrThrow(this.userRepository, email);
    if (user.shoppingCartId) {
      const existing = await this.cartRepository.findById(user.shoppingCartId);
      if (existing) return existing;
    }

    const cart = await this.cartRepository.create(uuidv4());
    await this.userRepository.updateShoppingCart(user.id, cart.id);
    return cart;
  }
}
