import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RegisterUseCase } from './register.use-case';
import { USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { JWTGenerator } from '../../../utils/JWTGenerator/JWTGenerator';
import { User } from '../../../domain/user/user.entity';

const mockUser = new User('id1', 'John', 'Doe', 30, 'john@test.com', 'pass123', null);
const mockTokens = { accessToken: 'access', refreshToken: 'refresh' };
const dto = { email: 'john@test.com', password: 'pass123', firstName: 'John', lastName: 'Doe', age: 30 };

describe('RegisterUseCase', () => {
  let useCase: RegisterUseCase;
  const mockRepo = { findByEmail: jest.fn(), create: jest.fn() };
  const mockJwt = { generateJWT: jest.fn().mockReturnValue(mockTokens) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegisterUseCase,
        { provide: USER_REPOSITORY, useValue: mockRepo },
        { provide: JWTGenerator, useValue: mockJwt },
      ],
    }).compile();
    useCase = module.get(RegisterUseCase);
    jest.clearAllMocks();
    mockJwt.generateJWT.mockReturnValue(mockTokens);
  });

  it('creates user and returns tokens when email is free', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(mockUser);
    const result = await useCase.execute(dto);
    expect(result.user).toBe(mockUser);
    expect(result.accessToken).toBe('access');
  });

  it('saves email in lowercase', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(mockUser);
    await useCase.execute({ ...dto, email: 'JOHN@TEST.COM' });
    expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'john@test.com' }));
  });

  it('sets shoppingCartId to null on creation', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue(mockUser);
    await useCase.execute(dto);
    expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ shoppingCartId: null }));
  });

  it('throws BadRequestException when email already exists', async () => {
    mockRepo.findByEmail.mockResolvedValue(mockUser);
    await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
  });
});
