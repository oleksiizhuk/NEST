import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IShoppingCartRepository,
  SHOPPING_CART_REPOSITORY,
} from '@domain/shopping-cart/shopping-cart.repository.interface';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '@domain/user/user.repository.interface';
import { findCartOwnerOrThrow } from '@application/shopping-cart/load-cart-owner';

@Injectable()
export class CompleteOrderUseCase {
  constructor(
    @Inject(SHOPPING_CART_REPOSITORY)
    private readonly cartRepository: IShoppingCartRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(email: string): Promise<void> {
    const user = await findCartOwnerOrThrow(this.userRepository, email);

    const cart = await this.cartRepository.findById(user.shoppingCartId);
    if (!cart) {
      throw new NotFoundException('Shopping cart not found');
    }
    if (!cart.items.length) {
      throw new BadRequestException('shopping cart is empty');
    }

    await this.userRepository.updateShoppingCart(user.id, null);
    await this.cartRepository.delete(cart.id);
  }
}
