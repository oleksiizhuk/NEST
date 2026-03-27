import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { IShoppingCartRepository, SHOPPING_CART_REPOSITORY } from '../../../domain/shopping-cart/shopping-cart.repository.interface';
import { IUserRepository, USER_REPOSITORY } from '../../../domain/user/user.repository.interface';

@Injectable()
export class CompleteOrderUseCase {
  constructor(
    @Inject(SHOPPING_CART_REPOSITORY)
    private readonly cartRepository: IShoppingCartRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(email: string): Promise<void> {
    const user = await this.userRepository.findByEmail(email);
    if (!user.shoppingCartId) {
      throw new BadRequestException('shoppingCart is null');
    }

    const cart = await this.cartRepository.findById(user.shoppingCartId);
    if (!cart.items.length) {
      throw new BadRequestException('shopping cart is empty');
    }

    await this.userRepository.updateShoppingCart(user.id, null);
  }
}