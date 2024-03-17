import { BadRequestException, Injectable, UseGuards } from '@nestjs/common';
import { ShoppingCartRepository } from './shoppingCart.repository';
import { UserService } from '../user/user.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ShoppingCartService {
  constructor(
    private readonly shoppingCartRepository: ShoppingCartRepository,
    private readonly userService: UserService,
  ) {}

  async add(id: string): Promise<any> {
    return this.shoppingCartRepository.add(id);
  }

  async getCart(): Promise<any> {
    return this.shoppingCartRepository.getCart('');
  }

  async shoppingCartIsEmpty(idShoppingCart): Promise<boolean> {
    const { items } = await this.shoppingCartRepository.getCart(idShoppingCart);
    return !items.length;
  }

  async completeOrder(email: string): Promise<any> {
    const { shoppingCart } = await this.userService.getUserByEmail(email);
    if (shoppingCart === null) {
      throw new BadRequestException(
        `something went wrong shoppingCart is null`,
      );
    }

    const shoppingCartIsEmpty = await this.shoppingCartIsEmpty(shoppingCart);
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
