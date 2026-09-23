import { NotFoundException } from '@nestjs/common';
import { CreateShoppingCartUseCase } from '@application/shopping-cart/use-cases/create-shopping-cart.use-case';
import { User } from '@domain/user/user.entity';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';

const withCart = () =>
  new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', 'cart-1');
const noCart = () =>
  new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', null);
const emptyCart = () =>
  new ShoppingCart('cart-1', [], { price: 0, discount: 0, finalPrice: 0 });

describe('CreateShoppingCartUseCase', () => {
  const cartRepo = { findById: jest.fn(), create: jest.fn() };
  const userRepo = { findByEmail: jest.fn(), updateShoppingCart: jest.fn() };
  let useCase: CreateShoppingCartUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    cartRepo.create.mockImplementation(
      async (id) =>
        new ShoppingCart(id, [], { price: 0, discount: 0, finalPrice: 0 }),
    );
    useCase = new CreateShoppingCartUseCase(cartRepo as any, userRepo as any);
  });

  it('creates a cart and links it to the user', async () => {
    userRepo.findByEmail.mockResolvedValue(noCart());
    const cart = await useCase.execute('john@test.com');
    expect(cartRepo.create).toHaveBeenCalledTimes(1);
    expect(userRepo.updateShoppingCart).toHaveBeenCalledWith('u1', cart.id);
  });

  it('returns the existing cart instead of orphaning it', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    const existing = emptyCart();
    cartRepo.findById.mockResolvedValue(existing);

    await expect(useCase.execute('john@test.com')).resolves.toBe(existing);
    expect(cartRepo.create).not.toHaveBeenCalled();
  });

  it('creates nothing when the user does not exist', async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    await expect(useCase.execute('gone@test.com')).rejects.toThrow(
      NotFoundException,
    );
    expect(cartRepo.create).not.toHaveBeenCalled();
  });
});
