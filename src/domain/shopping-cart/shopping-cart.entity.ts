import { Product } from '@domain/product/product.entity';

export interface CartItem {
  count: number;
  item: Product;
}

export interface CartPrice {
  price: number;
  discount: number;
  finalPrice: number;
}

export const MAX_ITEM_COUNT = 1000;

export class ShoppingCart {
  constructor(
    public readonly id: string,
    public items: CartItem[],
    public price: CartPrice,
  ) {}

  // Adds `count` of a product, merging with an existing line for the same
  // product, and recomputes the totals from every line.
  addItem(product: Product, count: number): void {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('count must be a positive integer');
    }
    const line = this.items.find(({ item }) => item.id === product.id);
    if (line) {
      if (line.count + count > MAX_ITEM_COUNT) {
        throw new Error(`count per product is limited to ${MAX_ITEM_COUNT}`);
      }
      line.count += count;
      line.item = product;
    } else {
      this.items.push({ count, item: product });
    }
    this.price = ShoppingCart.calculatePrice(this.items);
  }

  static calculatePrice(items: CartItem[]): CartPrice {
    const totals = items.reduce(
      (acc, { count, item }) => ({
        price: acc.price + item.price * count,
        discount: acc.discount + item.discount * count,
        finalPrice: acc.finalPrice,
      }),
      { price: 0, discount: 0, finalPrice: 0 },
    );
    totals.finalPrice = totals.price - totals.discount;
    return totals;
  }
}
