import { Test, TestingModule } from '@nestjs/testing';
import { DeleteUserUseCase } from '@application/user/use-cases/delete-user.use-case';
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

describe('DeleteUserUseCase', () => {
  let useCase: DeleteUserUseCase;
  const mockRepo = { delete: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteUserUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(DeleteUserUseCase);
    jest.clearAllMocks();
  });

  it('deletes and returns user', async () => {
    mockRepo.delete.mockResolvedValue(mockUser);
    const result = await useCase.execute('id1');
    expect(result).toBe(mockUser);
    expect(mockRepo.delete).toHaveBeenCalledWith('id1');
  });
});
