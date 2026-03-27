import { Test, TestingModule } from '@nestjs/testing';
import { UpdateUserShoppingCartUseCase } from '@application/user/use-cases/update-user-shopping-cart.use-case';
import { USER_REPOSITORY } from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';

describe('UpdateUserShoppingCartUseCase', () => {
  let useCase: UpdateUserShoppingCartUseCase;
  const mockRepo = { updateShoppingCart: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateUserShoppingCartUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(UpdateUserShoppingCartUseCase);
    jest.clearAllMocks();
  });

  it('assigns cart id to user', async () => {
    const updatedUser = new User(
      'id1',
      'John',
      'Doe',
      30,
      'john@test.com',
      'pass',
      'cart-1',
    );
    mockRepo.updateShoppingCart.mockResolvedValue(updatedUser);
    const result = await useCase.execute('id1', 'cart-1');
    expect(result.shoppingCartId).toBe('cart-1');
    expect(mockRepo.updateShoppingCart).toHaveBeenCalledWith('id1', 'cart-1');
  });

  it('clears cart id (null) from user', async () => {
    const updatedUser = new User(
      'id1',
      'John',
      'Doe',
      30,
      'john@test.com',
      'pass',
      null,
    );
    mockRepo.updateShoppingCart.mockResolvedValue(updatedUser);
    const result = await useCase.execute('id1', null);
    expect(result.shoppingCartId).toBeNull();
    expect(mockRepo.updateShoppingCart).toHaveBeenCalledWith('id1', null);
  });
});
