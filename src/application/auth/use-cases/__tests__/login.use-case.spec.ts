import { UnauthorizedException } from '@nestjs/common';
import { LoginUseCase } from '@application/auth/use-cases/login.use-case';
import { User } from '@domain/user/user.entity';

const hashedUser = () =>
  new User('id1', 'John', 'Doe', 30, 'john@test.com', '$2b$10$hash', null);
const tokens = { accessToken: 'access', refreshToken: 'refresh' };

describe('LoginUseCase', () => {
  const repo = { findByEmail: jest.fn(), update: jest.fn() };
  const hasher = {
    hash: jest.fn().mockResolvedValue('$2b$10$new'),
    verify: jest.fn(),
    isLegacy: jest.fn((s: string) => !s.startsWith('$2')),
  };
  const tokenService = { issue: jest.fn().mockReturnValue(tokens) };
  let useCase: LoginUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    tokenService.issue.mockReturnValue(tokens);
    useCase = new LoginUseCase(repo as any, hasher as any, tokenService as any);
  });

  it('returns the public profile and tokens on valid credentials', async () => {
    repo.findByEmail.mockResolvedValue(hashedUser());
    hasher.verify.mockResolvedValue(true);

    const result = await useCase.execute({
      email: 'john@test.com',
      password: 'pass123',
    });

    expect(result.user).not.toHaveProperty('password');
    expect(result.user.email).toBe('john@test.com');
    expect(result).toMatchObject(tokens);
    expect(hasher.verify).toHaveBeenCalledWith('pass123', '$2b$10$hash');
    expect(tokenService.issue).toHaveBeenCalledWith({
      userId: 'id1',
      email: 'john@test.com',
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('lowercases email before lookup', async () => {
    repo.findByEmail.mockResolvedValue(hashedUser());
    hasher.verify.mockResolvedValue(true);
    await useCase.execute({ email: 'JOHN@TEST.COM', password: 'pass123' });
    expect(repo.findByEmail).toHaveBeenCalledWith('john@test.com');
  });

  it('rejects an unknown email', async () => {
    repo.findByEmail.mockResolvedValue(null);
    hasher.verify.mockResolvedValue(false);
    await expect(
      useCase.execute({ email: 'x@x.com', password: 'pass' }),
    ).rejects.toThrow(UnauthorizedException);
    // Still hashes, so an unknown email answers as slowly as a wrong password.
    expect(hasher.verify).toHaveBeenCalledWith('pass', '');
  });

  it('rejects a wrong password', async () => {
    repo.findByEmail.mockResolvedValue(hashedUser());
    hasher.verify.mockResolvedValue(false);
    await expect(
      useCase.execute({ email: 'john@test.com', password: 'wrong' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rehashes a legacy plain-text password after a successful login', async () => {
    repo.findByEmail.mockResolvedValue(
      new User('id1', 'John', 'Doe', 30, 'john@test.com', 'pass123', null),
    );
    hasher.verify.mockResolvedValue(true);

    await useCase.execute({ email: 'john@test.com', password: 'pass123' });

    expect(hasher.hash).toHaveBeenCalledWith('pass123');
    expect(repo.update).toHaveBeenCalledWith('id1', { password: '$2b$10$new' });
  });
});
