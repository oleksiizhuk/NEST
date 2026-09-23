import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AddItemUseCase } from '@application/shopping-cart/use-cases/add-item.use-case';
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

describe('AddItemUseCase', () => {
  const cartRepo = { findById: jest.fn(), save: jest.fn() };
  const userRepo = { findByEmail: jest.fn() };
  const productRepo = { findById: jest.fn() };
  let useCase: AddItemUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    cartRepo.save.mockImplementation(async (c) => c);
    useCase = new AddItemUseCase(
      cartRepo as any,
      userRepo as any,
      productRepo as any,
    );
  });

  it('adds the product and saves the recomputed cart', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    productRepo.findById.mockResolvedValue(product('p1', 999, 100));
    cartRepo.findById.mockResolvedValue(emptyCart());

    const cart = await useCase.execute('john@test.com', 'p1', 2);

    expect(cart.items).toHaveLength(1);
    expect(cart.price).toEqual({
      price: 1998,
      discount: 200,
      finalPrice: 1798,
    });
    expect(cartRepo.save).toHaveBeenCalledWith(cart);
  });

  it('prices each line by its own product', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    const cart = emptyCart();
    cart.addItem(product('p1', 100), 1);
    cartRepo.findById.mockResolvedValue(cart);
    productRepo.findById.mockResolvedValue(product('p2', 10));

    const result = await useCase.execute('john@test.com', 'p2', 3);

    expect(result.price.price).toBe(130);
  });

  it('throws BadRequestException when user has no cart', async () => {
    userRepo.findByEmail.mockResolvedValue(noCart());
    await expect(useCase.execute('john@test.com', 'p1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws NotFoundException when the user no longer exists', async () => {
    userRepo.findByEmail.mockResolvedValue(null);
    await expect(useCase.execute('gone@test.com', 'p1', 1)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws BadRequestException when product not found', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    productRepo.findById.mockResolvedValue(null);
    await expect(
      useCase.execute('john@test.com', 'unknown', 1),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-positive count', async () => {
    userRepo.findByEmail.mockResolvedValue(withCart());
    productRepo.findById.mockResolvedValue(product('p1', 10));
    cartRepo.findById.mockResolvedValue(emptyCart());
    await expect(useCase.execute('john@test.com', 'p1', -5)).rejects.toThrow(
      BadRequestException,
    );
    expect(cartRepo.save).not.toHaveBeenCalled();
  });
});
