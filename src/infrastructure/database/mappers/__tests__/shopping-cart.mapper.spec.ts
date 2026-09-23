import { ShoppingCartMapper } from '@infrastructure/database/mappers/shopping-cart.mapper';
import { ShoppingCartDocument } from '@infrastructure/database/schemas/shopping-cart.schema';
import { ProductDocument } from '@infrastructure/database/schemas/product.schema';

const mockProductDoc = {
  id: 'p1',
  age: 0,
  type: 'phone',
  imageUrl: '',
  name: 'Phone',
  snippet: '',
  price: 500,
  discount: 50,
  screen: '',
  capacity: '',
  ram: '',
} as unknown as ProductDocument;

const mockDoc = {
  id: 'cart-uuid',
  items: [{ count: 2, item: mockProductDoc }],
  price: { price: 1000, discount: 100, finalPrice: 900 },
} as unknown as ShoppingCartDocument;

describe('ShoppingCartMapper', () => {
  describe('toDomain', () => {
    it('maps id and price correctly', () => {
      const cart = ShoppingCartMapper.toDomain(mockDoc);
      expect(cart.id).toBe('cart-uuid');
      expect(cart.price.price).toBe(1000);
      expect(cart.price.discount).toBe(100);
      expect(cart.price.finalPrice).toBe(900);
    });

    it('maps items with count', () => {
      const cart = ShoppingCartMapper.toDomain(mockDoc);
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].count).toBe(2);
      expect(cart.items[0].item.id).toBe('p1');
    });

    it('handles empty items array', () => {
      const emptyDoc = {
        ...mockDoc,
        items: [],
      } as unknown as ShoppingCartDocument;
      const cart = ShoppingCartMapper.toDomain(emptyDoc);
      expect(cart.items).toHaveLength(0);
    });

    it('recomputes totals from the items instead of trusting stored ones', () => {
      const stale = {
        ...mockDoc,
        price: { price: 1, discount: 0, finalPrice: 1 },
      } as unknown as ShoppingCartDocument;
      const cart = ShoppingCartMapper.toDomain(stale);
      expect(cart.price).toEqual({
        price: 1000,
        discount: 100,
        finalPrice: 900,
      });
    });

    it('drops lines whose product no longer exists', () => {
      const orphan = {
        ...mockDoc,
        items: [{ count: 1, item: null }, ...mockDoc.items],
      } as unknown as ShoppingCartDocument;
      const cart = ShoppingCartMapper.toDomain(orphan);
      expect(cart.items).toHaveLength(1);
      expect(cart.price.finalPrice).toBe(900);
    });
  });
});
