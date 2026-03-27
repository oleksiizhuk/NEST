import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';
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
