import { BadRequestException } from '@nestjs/common';
import { CompleteOrderUseCase } from '@application/shopping-cart/use-cases/complete-order.use-case';
import { User } from '@domain/user/user.entity';
import { Product } from '@domain/product/product.entity';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';

const withCart = () =>
  new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', 'cart-1');
const noCart = () =>
  new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', null);
const product = (id: string, price: number, discount = 0) =>
  new Product(id, 0, 'phone', '', id, '', price, discount, '', '', '');
const emptyCart = () =>
  new ShoppingCart('cart-1', [], { price: 0, discount: 0, finalPrice: 0 });

describe('CompleteOrderUseCase', () => {
  const cartRepo = { findById: jest.fn(), delete: jest.fn() };
  const userRepo = { findByEmail: jest.fn(), updateShoppingCart: jest.fn() };
  let useCase: CompleteOrderUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new CompleteOrderUseCase(cartRepo as any, userRepo as any);
  });

  it('detaches the cart from the user and deletes it', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    const cart = emptyCart();
    cart.addItem(product('p1', 10), 1);
    cartRepo.findById.mockResolvedValue(cart);

    await useCase.execute('john@test.com');

    expect(userRepo.updateShoppingCart).toHaveBeenCalledWith('u1', null);
    expect(cartRepo.delete).toHaveBeenCalledWith('cart-1');
  });

  it('rejects an empty cart', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    cartRepo.findById.mockResolvedValue(emptyCart());
    await expect(useCase.execute('john@test.com')).rejects.toThrow(
      BadRequestException,
    );
    expect(cartRepo.delete).not.toHaveBeenCalled();
  });

  it('rejects a user without a cart', async () => {
    userRepo.findByEmail.mockResolvedValue(noCart());
    await expect(useCase.execute('john@test.com')).rejects.toThrow(
      BadRequestException,
    );
  });
});
