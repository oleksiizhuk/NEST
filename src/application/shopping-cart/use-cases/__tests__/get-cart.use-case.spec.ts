import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GetCartUseCase } from '@application/shopping-cart/use-cases/get-cart.use-case';
import { User } from '@domain/user/user.entity';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';

const withCart = () =>
  new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', 'cart-1');
const noCart = () =>
  new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', null);
const emptyCart = () =>
  new ShoppingCart('cart-1', [], { price: 0, discount: 0, finalPrice: 0 });

describe('GetCartUseCase', () => {
  const cartRepo = { findById: jest.fn() };
  const userRepo = { findByEmail: jest.fn() };
  const useCase = new GetCartUseCase(cartRepo as any, userRepo as any);

  beforeEach(() => jest.clearAllMocks());

  it('returns the user’s cart', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    const cart = emptyCart();
    cartRepo.findById.mockResolvedValue(cart);
    await expect(useCase.execute('john@test.com')).resolves.toBe(cart);
    expect(cartRepo.findById).toHaveBeenCalledWith('cart-1');
  });

  it('throws BadRequestException when the user has no cart', async () => {
    userRepo.findByEmail.mockResolvedValue(noCart());
    await expect(useCase.execute('john@test.com')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when the user no longer exists', async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    await expect(useCase.execute('gone@test.com')).rejects.toThrow(
      NotFoundException,
    );
  });
});
