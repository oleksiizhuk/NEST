import { ProductMapper } from '../product.mapper';
import { ProductDocument } from '../../schemas/product.schema';

const mockDoc = {
  id: 'product-id',
  age: 1,
  type: 'phone',
  imageUrl: 'img/phone.jpg',
  name: 'iPhone',
  snippet: 'A great phone',
  price: 999,
  discount: 100,
  screen: '6.1 inches',
  capacity: '128GB',
  ram: '4GB',
} as unknown as ProductDocument;

describe('ProductMapper', () => {
  describe('toDomain', () => {
    it('maps all fields correctly', () => {
      const product = ProductMapper.toDomain(mockDoc);
      expect(product.id).toBe('product-id');
      expect(product.name).toBe('iPhone');
      expect(product.price).toBe(999);
      expect(product.discount).toBe(100);
      expect(product.type).toBe('phone');
      expect(product.screen).toBe('6.1 inches');
      expect(product.capacity).toBe('128GB');
      expect(product.ram).toBe('4GB');
    });
  });
});
