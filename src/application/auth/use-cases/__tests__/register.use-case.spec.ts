import { BadRequestException } from '@nestjs/common';
import { RegisterUseCase } from '@application/auth/use-cases/register.use-case';
import { User } from '@domain/user/user.entity';

const dto = {
  email: 'John@Test.com',
  password: 'Secret1!',
  firstName: 'John',
  lastName: 'Doe',
  age: 30,
};
const tokens = { accessToken: 'access', refreshToken: 'refresh' };

describe('RegisterUseCase', () => {
  const repo = { findByEmail: jest.fn(), create: jest.fn() };
  const hasher = { hash: jest.fn().mockResolvedValue('$2b$10$hash') };
  const tokenService = { issue: jest.fn().mockReturnValue(tokens) };
  let useCase: RegisterUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    hasher.hash.mockResolvedValue('$2b$10$hash');
    tokenService.issue.mockReturnValue(tokens);
    repo.create.mockImplementation(
      async (d) =>
        new User(
          'id1',
          d.firstName,
          d.lastName,
          d.age,
          d.email,
          d.password,
          null,
        ),
    );
    useCase = new RegisterUseCase(
      repo as any,
      hasher as any,
      tokenService as any,
    );
  });

  it('stores a hash, never the plain password', async () => {
    repo.findByEmail.mockResolvedValue(null);
    await useCase.execute(dto);
    expect(repo.create).toHaveBeenCalledWith({
      firstName: 'John',
      lastName: 'Doe',
      age: 30,
      email: 'john@test.com',
      password: '$2b$10$hash',
      shoppingCartId: null,
    });
  });

  it('returns the public profile and tokens', async () => {
    repo.findByEmail.mockResolvedValue(null);
    const result = await useCase.execute(dto);
    expect(result.user).not.toHaveProperty('password');
    expect(result).toMatchObject(tokens);
  });

  it('rejects a taken email', async () => {
    repo.findByEmail.mockResolvedValue(
      new User('id0', 'A', 'B', 20, 'john@test.com', 'x', null),
    );
    await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
