import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AddItemUseCase } from '../add-item.use-case';
import { SHOPPING_CART_REPOSITORY } from '../../../../domain/shopping-cart/shopping-cart.repository.interface';
import { USER_REPOSITORY } from '../../../../domain/user/user.repository.interface';
import { PRODUCT_REPOSITORY } from '../../../../domain/product/product.repository.interface';
import { User } from '../../../../domain/user/user.entity';
import { Product } from '../../../../domain/product/product.entity';
import { ShoppingCart } from '../../../../domain/shopping-cart/shopping-cart.entity';

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
const mockProduct = new Product(
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
const mockCart = new ShoppingCart('cart-1', [], {
  price: 0,
  discount: 0,
  finalPrice: 0,
});

describe('AddItemUseCase', () => {
  let useCase: AddItemUseCase;
  const mockCartRepo = { addItem: jest.fn() };
  const mockUserRepo = { findByEmail: jest.fn() };
  const mockProductRepo = { findById: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddItemUseCase,
        { provide: SHOPPING_CART_REPOSITORY, useValue: mockCartRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: PRODUCT_REPOSITORY, useValue: mockProductRepo },
      ],
    }).compile();
    useCase = module.get(AddItemUseCase);
    jest.clearAllMocks();
  });

  it('adds item to cart', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUser);
    mockProductRepo.findById.mockResolvedValue(mockProduct);
    mockCartRepo.addItem.mockResolvedValue(mockCart);

    const result = await useCase.execute('john@test.com', 'p1', 2);
    expect(result).toBe(mockCart);
    expect(mockCartRepo.addItem).toHaveBeenCalledWith('cart-1', mockProduct, 2);
  });

  it('throws BadRequestException when user has no cart', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUserNoCart);
    await expect(useCase.execute('john@test.com', 'p1', 1)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException when product not found', async () => {
    mockUserRepo.findByEmail.mockResolvedValue(mockUser);
    mockProductRepo.findById.mockResolvedValue(null);
    await expect(
      useCase.execute('john@test.com', 'unknown', 1),
    ).rejects.toThrow(BadRequestException);
  });
});
