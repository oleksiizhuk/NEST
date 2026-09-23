import {
  MAX_ITEM_COUNT,
  ShoppingCart,
} from '@domain/shopping-cart/shopping-cart.entity';
import { Product } from '@domain/product/product.entity';

const makeProduct = (price: number, discount: number): Product =>
  new Product('p1', 0, 'phone', '', 'Phone', '', price, discount, '', '', '');

describe('ShoppingCart entity', () => {
  describe('calculatePrice', () => {
    it('returns zeros for empty items', () => {
      const result = ShoppingCart.calculatePrice([]);
      expect(result).toEqual({ price: 0, discount: 0, finalPrice: 0 });
    });

    it('calculates totals for single item', () => {
      const result = ShoppingCart.calculatePrice([
        { count: 2, item: makeProduct(100, 10) },
      ]);
      expect(result).toEqual({ price: 200, discount: 20, finalPrice: 180 });
    });

    it('calculates totals for multiple items', () => {
      const result = ShoppingCart.calculatePrice([
        { count: 1, item: makeProduct(500, 50) },
        { count: 3, item: makeProduct(100, 0) },
      ]);
      expect(result).toEqual({ price: 800, discount: 50, finalPrice: 750 });
    });

    it('finalPrice equals price minus discount', () => {
      const result = ShoppingCart.calculatePrice([
        { count: 1, item: makeProduct(1000, 200) },
      ]);
      expect(result.finalPrice).toBe(result.price - result.discount);
    });
  });
});

describe('ShoppingCart.addItem', () => {
  const product = (id: string, price: number, discount = 0) =>
    new Product(id, 0, 'phone', '', id, '', price, discount, '', '', '');
  const cart = () =>
    new ShoppingCart('c', [], { price: 0, discount: 0, finalPrice: 0 });

  it('merges repeated adds of the same product into one line', () => {
    const c = cart();
    c.addItem(product('p1', 10), 1);
    c.addItem(product('p1', 10), 2);
    expect(c.items).toHaveLength(1);
    expect(c.items[0].count).toBe(3);
    expect(c.price.price).toBe(30);
  });

  it('prices every line by its own product', () => {
    const c = cart();
    c.addItem(product('p1', 100, 10), 1);
    c.addItem(product('p2', 5), 2);
    expect(c.price).toEqual({ price: 110, discount: 10, finalPrice: 100 });
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects count %p', (count) => {
    expect(() => cart().addItem(product('p1', 10), count)).toThrow();
  });

  it('caps the count per product', () => {
    const c = cart();
    c.addItem(product('p1', 1), MAX_ITEM_COUNT);
    expect(() => c.addItem(product('p1', 1), 1)).toThrow();
  });
});
