import { Test, TestingModule } from '@nestjs/testing';
import { UpdateUserUseCase } from './update-user.use-case';
import { USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';

const updatedUser = new User(
  'id1',
  'Updated',
  'Doe',
  30,
  'john@test.com',
  'pass',
  null,
);

describe('UpdateUserUseCase', () => {
  let useCase: UpdateUserUseCase;
  const mockRepo = { update: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UpdateUserUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(UpdateUserUseCase);
    jest.clearAllMocks();
  });

  it('returns updated user', async () => {
    mockRepo.update.mockResolvedValue(updatedUser);
    const result = await useCase.execute('id1', { firstName: 'Updated' });
    expect(result.firstName).toBe('Updated');
    expect(mockRepo.update).toHaveBeenCalledWith('id1', {
      firstName: 'Updated',
    });
  });
});
