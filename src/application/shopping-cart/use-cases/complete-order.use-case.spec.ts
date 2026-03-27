import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CompleteOrderUseCase } from './complete-order.use-case';
import { SHOPPING_CART_REPOSITORY } from '../../../domain/shopping-cart/shopping-cart.repository.interface';
import { USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';
import { ShoppingCart } from '../../../domain/shopping-cart/shopping-cart.entity';
import { Product } from '../../../domain/product/product.entity';

const mockUser = new User(
  'u1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'pass',
  'cart-1',
);
const mockUserNoCart = new User(
  'u1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'pass',
  null,
);
const product = new Product(
  'p1',
  0,
  'phone',
  '',
  'iPhone',
  '',
  999,
  0,
  '',
  '',
  '',
);
const cartWithItems = new ShoppingCart(
  'cart-1',
  [{ count: 1, item: product }],
  { price: 999, discount: 0, finalPrice: 999 },
);
const emptyCart = new ShoppingCart('cart-1', [], {
  price: 0,
  discount: 0,
  finalPrice: 0,
});

describe('CompleteOrderUseCase', () => {
  let useCase: CompleteOrderUseCase;
  const mockCartRepo = { findById: jest.fn() };
  const mockUserRepo = {
    findByEmail: jest.fn(),
    updateShoppingCart: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompleteOrderUseCase,
        { provide: SHOPPING_CART_REPOSITORY, useValue: mockCartRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
      ],
    }).compile();
    useCase = module.get(CompleteOrderUseCase);
    jest.clearAllMocks();
  });

  it('completes order and clears cart from user', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUser);
    mockCartRepo.findById.mockResolvedValue(cartWithItems);
    mockUserRepo.updateShoppingCart.mockResolvedValue({
      ...mockUser,
      shoppingCartId: null,
    });

    await useCase.execute('john@test.com');
    expect(mockUserRepo.updateShoppingCart).toHaveBeenCalledWith('u1', null);
  });

  it('throws BadRequestException when user has no cart', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUserNoCart);
    await expect(useCase.execute('john@test.com')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when cart is empty', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUser);
    mockCartRepo.findById.mockResolvedValue(emptyCart);
    await expect(useCase.execute('john@test.com')).rejects.toThrow(
      BadRequestException,
    );
  });
});
