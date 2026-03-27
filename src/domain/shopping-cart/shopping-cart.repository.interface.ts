import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';
import { Product } from '@domain/product/product.entity';

export const SHOPPING_CART_REPOSITORY = 'SHOPPING_CART_REPOSITORY';

export interface IShoppingCartRepository {
  findById(cartId: string): Promise<ShoppingCart | null>;
  create(id: string): Promise<ShoppingCart>;
  addItem(cartId: string, item: Product, count: number): Promise<ShoppingCart>;
}
