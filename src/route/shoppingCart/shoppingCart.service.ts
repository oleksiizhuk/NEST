import { BadRequestException, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ShoppingCartRepository } from './shoppingCart.repository';
import { UserService } from '../user/user.service';
import { ProductService } from '../product/product.service';
import { ShoppingCartEntity } from './entity/shoppingCart.entity';

@Injectable()
export class ShoppingCartService {
  constructor(
    private readonly shoppingCartRepository: ShoppingCartRepository,
    private readonly userService: UserService,
    private readonly productService: ProductService,
  ) {}

  async addItem(
    email: string,
    itemID: string,
    count: number,
  ): Promise<ShoppingCartEntity> {
    const { shoppingCartId } = await this.userService.getUserByEmail(email);
    if (shoppingCartId === null) {
      throw new BadRequestException(`shoppingCart is null`);
    }

    const item = await this.productService.getByID(itemID);
    if (!item) {
      throw new BadRequestException(
        `product with this ${itemID} does not exist`,
      );
    }

    return await this.shoppingCartRepository.addItem(
      shoppingCartId,
      item,
      count,
    );
  }

  async getCart(email: string): Promise<ShoppingCartEntity> {
    const { shoppingCartId } = await this.userService.getUserByEmail(email);
    if (shoppingCartId === null) {
      throw new BadRequestException(`shoppingCart is null`);
    }

    return this.shoppingCartRepository.getCart(shoppingCartId);
  }

  async shoppingCartIsEmpty(shoppingCartId): Promise<boolean> {
    const { items } = await this.shoppingCartRepository.getCart(shoppingCartId);
    return !items.length;
  }

  async completeOrder(email: string): Promise<any> {
    const { shoppingCartId } = await this.userService.getUserByEmail(email);
    if (shoppingCartId === null) {
      throw new BadRequestException(`shoppingCart is null`);
    }

    const shoppingCartIsEmpty = await this.shoppingCartIsEmpty(shoppingCartId);
    if (shoppingCartIsEmpty) {
      throw new BadRequestException('shopping cart is empty');
    }

    const user = await this.userService.getUserByEmail(email);

    await this.userService.addShoppingShoppingCartToUser(user._id, null);
  }

  async createShoppingCart(email: string) {
    const id = uuidv4();

    const shoppingCart = await this.shoppingCartRepository.createShoppingCart(
      id,
    );

    const user = await this.userService.getUserByEmail(email);

    await this.userService.addShoppingShoppingCartToUser(
      user._id,
      shoppingCart.id,
    );

    return shoppingCart;
  }
}
