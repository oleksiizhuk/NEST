import { Test, TestingModule } from '@nestjs/testing';
import { GetProfileUseCase } from '@application/auth/use-cases/get-profile.use-case';
import { USER_REPOSITORY } from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';

const mockUser = new User(
  'id1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'secret',
  'cart-1',
);

describe('GetProfileUseCase', () => {
  let useCase: GetProfileUseCase;
  const mockRepo = { findByEmail: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetProfileUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(GetProfileUseCase);
    jest.clearAllMocks();
  });

  it('returns public profile without password', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    const result = await useCase.execute('john@test.com');
    expect(result).not.toHaveProperty('password');
    expect(result.email).toBe('john@test.com');
  });

  it('lowercases email before lookup', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    await useCase.execute('JOHN@TEST.COM');
    expect(mockRepo.findByEmail).toHaveBeenCalledWith('john@test.com');
  });
});
