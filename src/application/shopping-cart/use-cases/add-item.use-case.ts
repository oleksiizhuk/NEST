import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  IShoppingCartRepository,
  SHOPPING_CART_REPOSITORY,
} from '../../../domain/shopping-cart/shopping-cart.repository.interface';
import {
  IUserRepository,
  USER_REPOSITORY,
} from '../../../domain/user/user.repository.interface';
import {
  IProductRepository,
  PRODUCT_REPOSITORY,
} from '../../../domain/product/product.repository.interface';
import { ShoppingCart } from '../../../domain/shopping-cart/shopping-cart.entity';

@Injectable()
export class AddItemUseCase {
  constructor(
    @Inject(SHOPPING_CART_REPOSITORY)
    private readonly cartRepository: IShoppingCartRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
  ) {}

  async execute(
    email: string,
    itemId: string,
    count: number,
  ): Promise<ShoppingCart> {
    const user = await this.userRepository.findByEmail(email);
    if (!user.shoppingCartId) {
      throw new BadRequestException('shoppingCart is null');
    }

    const item = await this.productRepository.findById(itemId);
    if (!item) {
      throw new BadRequestException(
        `product with this ${itemId} does not exist`,
      );
    }

    return this.cartRepository.addItem(user.shoppingCartId, item, count);
  }
}
