import { ForbiddenException } from '@nestjs/common';
import { DeleteUserUseCase } from '@application/user/use-cases/delete-user.use-case';
import { User } from '@domain/user/user.entity';

describe('DeleteUserUseCase', () => {
  const repo = { findByEmail: jest.fn(), delete: jest.fn() };
  const useCase = new DeleteUserUseCase(repo as any);

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findByEmail.mockResolvedValue(
      new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', null),
    );
  });

  it('deletes the caller’s own account', async () => {
    await useCase.execute('john@test.com', 'u1');
    expect(repo.delete).toHaveBeenCalledWith('u1');
  });

  it('forbids deleting another user', async () => {
    await expect(useCase.execute('john@test.com', 'u2')).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
