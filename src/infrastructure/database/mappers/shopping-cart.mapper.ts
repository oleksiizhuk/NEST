import { ShoppingCart, CartItem } from '../../../domain/shopping-cart/shopping-cart.entity';
import { ShoppingCartDocument } from '../schemas/shopping-cart.schema';
import { ProductMapper } from './product.mapper';
import { ProductDocument } from '../schemas/product.schema';

export class ShoppingCartMapper {
  static toDomain(doc: ShoppingCartDocument): ShoppingCart {
    const items: CartItem[] = (doc.items || []).map(({ count, item }) => ({
      count,
      item: ProductMapper.toDomain(item as ProductDocument),
    }));

    return new ShoppingCart(doc.id, items, {
      price: doc.price?.price ?? 0,
      discount: doc.price?.discount ?? 0,
      finalPrice: doc.price?.finalPrice ?? 0,
    });
  }
}