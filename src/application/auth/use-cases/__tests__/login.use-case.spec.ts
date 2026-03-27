import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LoginUseCase } from '@application/auth/use-cases/login.use-case';
import { USER_REPOSITORY } from '@domain/user/user.repository.interface';
import { JWTGenerator } from '@infrastructure/http/auth/utils/jwt-generator';
import { User } from '@domain/user/user.entity';

const mockUser = new User(
  'id1',
  'John',
  'Doe',
  30,
  'john@test.com',
  'pass123',
  null,
);
const mockTokens = { accessToken: 'access', refreshToken: 'refresh' };

describe('LoginUseCase', () => {
  let useCase: LoginUseCase;
  const mockRepo = { findByEmail: jest.fn() };
  const mockJwt = { generateJWT: jest.fn().mockReturnValue(mockTokens) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
        { provide: JWTGenerator, useValue: mockJwt },
      ],
    }).compile();
    useCase = module.get(LoginUseCase);
    jest.clearAllMocks();
    mockJwt.generateJWT.mockReturnValue(mockTokens);
  });

  it('returns user and tokens on valid credentials', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    const result = await useCase.execute({
      email: 'john@test.com',
      password: 'pass123',
    });
    expect(result.user).toBe(mockUser);
    expect(result.accessToken).toBe('access');
    expect(result.refreshToken).toBe('refresh');
  });

  it('lowercases email before lookup', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    await useCase.execute({ email: 'JOHN@TEST.COM', password: 'pass123' });
    expect(mockRepo.findByEmail).toHaveBeenCalledWith('john@test.com');
  });

  it('throws BadRequestException when user not found', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    await expect(
      useCase.execute({ email: 'x@x.com', password: 'pass' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException on wrong password', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    await expect(
      useCase.execute({ email: 'john@test.com', password: 'wrong' }),
    ).rejects.toThrow(BadRequestException);
  });
});
