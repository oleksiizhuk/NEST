import { UserMapper } from './user.mapper';
import { UserDocument } from '../schemas/user.schema';

const mockDoc = {
  _id: { toString: () => 'doc-id' },
  firstName: 'John',
  lastName: 'Doe',
  age: 30,
  email: 'john@test.com',
  password: 'secret',
  shoppingCartId: 'cart-1',
} as unknown as UserDocument;

describe('UserMapper', () => {
  describe('toDomain', () => {
    it('maps all fields correctly', () => {
      const user = UserMapper.toDomain(mockDoc);
      expect(user.id).toBe('doc-id');
      expect(user.firstName).toBe('John');
      expect(user.lastName).toBe('Doe');
      expect(user.age).toBe(30);
      expect(user.email).toBe('john@test.com');
      expect(user.password).toBe('secret');
      expect(user.shoppingCartId).toBe('cart-1');
    });

    it('returns a User instance with toPublicProfile method', () => {
      const user = UserMapper.toDomain(mockDoc);
      expect(typeof user.toPublicProfile).toBe('function');
    });
  });
});
