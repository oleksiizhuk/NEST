import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';

export const SHOPPING_CART_REPOSITORY = 'SHOPPING_CART_REPOSITORY';

export interface IShoppingCartRepository {
  findById(cartId: string): Promise<ShoppingCart | null>;
  create(id: string): Promise<ShoppingCart>;
  save(cart: ShoppingCart): Promise<ShoppingCart>;
  delete(cartId: string): Promise<void>;
}
