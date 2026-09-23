import {
  ShoppingCart,
  CartItem,
} from '@domain/shopping-cart/shopping-cart.entity';
import { ShoppingCartDocument } from '@infrastructure/database/schemas/shopping-cart.schema';
import { ProductMapper } from '@infrastructure/database/mappers/product.mapper';
import { ProductDocument } from '@infrastructure/database/schemas/product.schema';

export class ShoppingCartMapper {
  static toDomain(doc: ShoppingCartDocument): ShoppingCart {
    const items: CartItem[] = (doc.items || [])
      .filter(({ item }) => item && typeof item === 'object' && 'price' in item)
      .map(({ count, item }) => ({
        count,
        item: ProductMapper.toDomain(item as ProductDocument),
      }));

    return new ShoppingCart(doc.id, items, ShoppingCart.calculatePrice(items));
  }
}
