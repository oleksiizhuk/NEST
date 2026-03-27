import { Test, TestingModule } from '@nestjs/testing';
import { GetUsersUseCase } from '../get-users.use-case';
import { USER_REPOSITORY } from '../../../../domain/user/user.repository.interface';
import { User } from '../../../../domain/user/user.entity';

const mockUsers = [
  new User('id1', 'John', 'Doe', 30, 'john@test.com', 'pass', null),
  new User('id2', 'Jane', 'Doe', 25, 'jane@test.com', 'pass', null),
];

describe('GetUsersUseCase', () => {
  let useCase: GetUsersUseCase;
  const mockRepo = { findAll: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetUsersUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(GetUsersUseCase);
    jest.clearAllMocks();
  });

  it('returns all users', async () => {
    mockRepo.findAll.mockResolvedValue(mockUsers);
    const result = await useCase.execute();
    expect(result).toEqual(mockUsers);
    expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
  });

  it('returns empty array when no users', async () => {
    mockRepo.findAll.mockResolvedValue([]);
    const result = await useCase.execute();
    expect(result).toEqual([]);
  });
});
