import { Test, TestingModule } from '@nestjs/testing';
import { GetUserByEmailUseCase } from './get-user-by-email.use-case';
import { USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { User } from '../../../domain/user/user.entity';

const mockUser = new User(
  'id1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'pass',
  null,
);

describe('GetUserByEmailUseCase', () => {
  let useCase: GetUserByEmailUseCase;
  const mockRepo = { findByEmail: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetUserByEmailUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(GetUserByEmailUseCase);
    jest.clearAllMocks();
  });

  it('returns user by email', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    const result = await useCase.execute('john@test.com');
    expect(result).toBe(mockUser);
  });

  it('lowercases email before lookup', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    await useCase.execute('JOHN@TEST.COM');
    expect(mockRepo.findByEmail).toHaveBeenCalledWith('john@test.com');
  });

  it('returns null when not found', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    const result = await useCase.execute('x@x.com');
    expect(result).toBeNull();
  });
});
