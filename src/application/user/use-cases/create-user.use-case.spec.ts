import { Test, TestingModule } from '@nestjs/testing';
import { CreateUserUseCase } from './create-user.use-case';
import { USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';

const dto = {
  firstName: 'John',
  lastName: 'Doe',
  age: 30,
  email: 'JOHN@TEST.COM',
  password: 'pass123',
};
const createdUser = new User(
  'id1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'pass123',
  null,
);

describe('CreateUserUseCase', () => {
  let useCase: CreateUserUseCase;
  const mockRepo = { create: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateUserUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(CreateUserUseCase);
    jest.clearAllMocks();
  });

  it('creates and returns user', async () => {
    mockRepo.create.mockResolvedValue(createdUser);
    const result = await useCase.execute(dto);
    expect(result).toBe(createdUser);
  });

  it('lowercases email before saving', async () => {
    mockRepo.create.mockResolvedValue(createdUser);
    await useCase.execute(dto);
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'john@test.com' }),
    );
  });

  it('sets shoppingCartId to null', async () => {
    mockRepo.create.mockResolvedValue(createdUser);
    await useCase.execute(dto);
    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ shoppingCartId: null }),
    );
  });
});
