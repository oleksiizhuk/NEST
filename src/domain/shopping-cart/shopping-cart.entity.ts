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

export class ShoppingCart {
  constructor(
    public readonly id: string,
    public items: CartItem[],
    public price: CartPrice,
  ) {}

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
