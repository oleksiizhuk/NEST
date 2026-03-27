import { Test, TestingModule } from '@nestjs/testing';
import { CreateShoppingCartUseCase } from '../create-shopping-cart.use-case';
import { SHOPPING_CART_REPOSITORY } from '../../../../domain/shopping-cart/shopping-cart.repository.interface';
import { USER_REPOSITORY } from '../../../../domain/user/user.repository.interface';
import { ShoppingCart } from '../../../../domain/shopping-cart/shopping-cart.entity';
import { User } from '../../../../domain/user/user.entity';

const mockUser = new User(
  'user-1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'pass',
  null,
);
const mockCart = new ShoppingCart('cart-uuid', [], {
  price: 0,
  discount: 0,
  finalPrice: 0,
});

describe('CreateShoppingCartUseCase', () => {
  let useCase: CreateShoppingCartUseCase;
  const mockCartRepo = { create: jest.fn() };
  const mockUserRepo = {
    findByEmail: jest.fn(),
    updateShoppingCart: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateShoppingCartUseCase,
        { provide: SHOPPING_CART_REPOSITORY, useValue: mockCartRepo },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
      ],
    }).compile();
    useCase = module.get(CreateShoppingCartUseCase);
    jest.clearAllMocks();
  });

  it('creates cart and links it to user', async () => {
    mockCartRepo.create.mockResolvedValue(mockCart);
    mockUserRepo.findByEmail.mockResolvedValue(mockUser);
    mockUserRepo.updateShoppingCart.mockResolvedValue({
      ...mockUser,
      shoppingCartId: 'cart-uuid',
    });

    const result = await useCase.execute('john@test.com');
    expect(result).toBe(mockCart);
    expect(mockUserRepo.updateShoppingCart).toHaveBeenCalledWith(
      'user-1',
      'cart-uuid',
    );
  });
});
