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
import {
  IProductRepository,
  PRODUCT_REPOSITORY,
} from '@domain/product/product.repository.interface';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';
import { findCartOwnerOrThrow } from '@application/shopping-cart/load-cart-owner';

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
    const user = await findCartOwnerOrThrow(this.userRepository, email);

    const item = await this.productRepository.findById(itemId);
    if (!item) {
      throw new BadRequestException(
        `product with this ${itemId} does not exist`,
      );
    }

    const cart = await this.cartRepository.findById(user.shoppingCartId);
    if (!cart) {
      throw new NotFoundException('Shopping cart not found');
    }

    try {
      cart.addItem(item, count);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    return this.cartRepository.save(cart);
  }
}
