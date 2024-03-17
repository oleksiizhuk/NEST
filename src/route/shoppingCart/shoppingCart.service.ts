import { Injectable } from '@nestjs/common';
import { ShoppingCartRepository } from './shoppingCart.repository';

@Injectable()
export class ShoppingCartService {
  constructor(
    private readonly shoppingCartRepository: ShoppingCartRepository,
  ) {}

  async add(): Promise<any> {
    return this.shoppingCartRepository.add();
  }
}
