import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserUseCase } from '@application/user/use-cases/update-user.use-case';
import { User } from '@domain/user/user.entity';

const owner = () =>
  new User('u1', 'John', 'Doe', 30, 'john@test.com', 'h', null);

describe('UpdateUserUseCase', () => {
  const repo = { findByEmail: jest.fn(), update: jest.fn() };
  const hasher = { hash: jest.fn() };
  let useCase: UpdateUserUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    hasher.hash.mockResolvedValue('$2b$10$hash');
    repo.findByEmail.mockImplementation(async (e) =>
      e === 'john@test.com' ? owner() : null,
    );
    repo.update.mockImplementation(async (_id, data) =>
      Object.assign(owner(), data),
    );
    useCase = new UpdateUserUseCase(repo as any, hasher as any);
  });

  it('updates the caller’s own account and returns the public profile', async () => {
    const result = await useCase.execute('john@test.com', 'u1', {
      firstName: 'Jane',
    });
    expect(repo.update).toHaveBeenCalledWith('u1', { firstName: 'Jane' });
    expect(result.firstName).toBe('Jane');
    expect(result).not.toHaveProperty('password');
  });

  it('forbids changing another user’s account', async () => {
    await expect(
      useCase.execute('john@test.com', 'someone-else', { firstName: 'X' }),
    ).rejects.toThrow(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('hashes a new password', async () => {
    await useCase.execute('john@test.com', 'u1', { password: 'newpass12' });
    expect(repo.update).toHaveBeenCalledWith('u1', { password: '$2b$10$hash' });
  });

  it('rejects an email that belongs to someone else', async () => {
    repo.findByEmail.mockImplementation(async (e) =>
      e === 'john@test.com'
        ? owner()
        : new User('u2', 'A', 'B', 20, 'taken@test.com', 'h', null),
    );
    await expect(
      useCase.execute('john@test.com', 'u1', { email: 'Taken@test.com' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when the caller no longer exists', async () => {
    await expect(
      useCase.execute('gone@test.com', 'u1', { firstName: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });
});
