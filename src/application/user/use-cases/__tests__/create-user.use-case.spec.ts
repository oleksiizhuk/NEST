import { BadRequestException } from '@nestjs/common';
import { CreateUserUseCase } from '@application/user/use-cases/create-user.use-case';
import { User } from '@domain/user/user.entity';

const dto = {
  firstName: 'John',
  lastName: 'Doe',
  age: 30,
  email: 'JOHN@TEST.COM',
  password: 'pass1234',
};

describe('CreateUserUseCase', () => {
  const repo = { findByEmail: jest.fn(), create: jest.fn() };
  const hasher = { hash: jest.fn() };
  let useCase: CreateUserUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    hasher.hash.mockResolvedValue('$2b$10$hash');
    repo.findByEmail.mockResolvedValue(null);
    repo.create.mockImplementation(
      async (d) =>
        new User(
          'id1',
          d.firstName,
          d.lastName,
          d.age,
          d.email,
          d.password,
          d.shoppingCartId,
        ),
    );
    useCase = new CreateUserUseCase(repo as any, hasher as any);
  });

  it('saves a lowercased email, a hashed password and no cart', async () => {
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

  it('returns the public profile without the password', async () => {
    const result = await useCase.execute(dto);
    expect(result).not.toHaveProperty('password');
    expect(result.id).toBe('id1');
  });

  it('rejects a taken email', async () => {
    repo.findByEmail.mockResolvedValue(
      new User('id0', 'A', 'B', 20, 'john@test.com', 'x', null),
    );
    await expect(useCase.execute(dto)).rejects.toThrow(BadRequestException);
  });
});
