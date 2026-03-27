import { Test, TestingModule } from '@nestjs/testing';
import { GetUserByIdUseCase } from '@application/user/use-cases/get-user-by-id.use-case';
import { USER_REPOSITORY } from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';

const mockUser = new User(
  'id1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'pass',
  null,
);

describe('GetUserByIdUseCase', () => {
  let useCase: GetUserByIdUseCase;
  const mockRepo = { findById: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetUserByIdUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(GetUserByIdUseCase);
    jest.clearAllMocks();
  });

  it('returns user by id', async () => {
    mockRepo.findById.mockResolvedValue(mockUser);
    const result = await useCase.execute('id1');
    expect(result).toBe(mockUser);
    expect(mockRepo.findById).toHaveBeenCalledWith('id1');
  });

  it('returns null when user not found', async () => {
    mockRepo.findById.mockResolvedValue(null);
    const result = await useCase.execute('unknown');
    expect(result).toBeNull();
  });
});
