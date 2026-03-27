import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { IShoppingCartRepository, SHOPPING_CART_REPOSITORY } from '../../../domain/shopping-cart/shopping-cart.repository.interface';
import { IUserRepository, USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { ShoppingCart } from '../../../domain/shopping-cart/shopping-cart.entity';

@Injectable()
export class GetCartUseCase {
  constructor(
    @Inject(SHOPPING_CART_REPOSITORY)
    private readonly cartRepository: IShoppingCartRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
  ) {}

  async execute(email: string): Promise<ShoppingCart> {
    const user = await this.userRepository.findByEmail(email);
    if (!user.shoppingCartId) {
      throw new BadRequestException('shoppingCart is null');
    }
    return this.cartRepository.findById(user.shoppingCartId);
  }
}