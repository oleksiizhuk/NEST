import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GetCartUseCase } from './get-cart.use-case';
import { SHOPPING_CART_REPOSITORY } from '../../../domain/shopping-cart/shopping-cart.repository.interface';
import { USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';
import { ShoppingCart } from '../../../domain/shopping-cart/shopping-cart.entity';

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
const mockCart = new ShoppingCart('cart-1', [], {
  price: 0,
  discount: 0,
  finalPrice: 0,
});

describe('GetCartUseCase', () => {
  let useCase: GetCartUseCase;
  const mockCartRepo = { findById: jest.fn() };
  const mockUserRepo = { findByEmail: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetCartUseCase,
        { provide: SHOPPING_CART_REPOSITORY, useValue: mockCartRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
      ],
    }).compile();
    useCase = module.get(GetCartUseCase);
    jest.clearAllMocks();
  });

  it('returns cart for user', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUser);
    mockCartRepo.findById.mockResolvedValue(mockCart);
    const result = await useCase.execute('john@test.com');
    expect(result).toBe(mockCart);
    expect(mockCartRepo.findById).toHaveBeenCalledWith('cart-1');
  });

  it('throws BadRequestException when user has no cart', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUserNoCart);
    await expect(useCase.execute('john@test.com')).rejects.toThrow(
      BadRequestException,
    );
  });
});
