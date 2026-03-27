import { User } from './user.entity';

describe('User entity', () => {
  const user = new User('id1', 'John', 'Doe', 25, 'john@test.com', 'secret', 'cart-1');

  describe('toPublicProfile', () => {
    it('returns all fields except password', () => {
      const profile = user.toPublicProfile();
      expect(profile).toEqual({
        id: 'id1',
        firstName: 'John',
        lastName: 'Doe',
        age: 25,
        email: 'john@test.com',
        shoppingCartId: 'cart-1',
      });
    });

    it('does not include password', () => {
      const profile = user.toPublicProfile();
      expect(profile).not.toHaveProperty('password');
    });
  });
});
