import { NotFoundException } from '@nestjs/common';
import { GetUserByIdUseCase } from '@application/user/use-cases/get-user-by-id.use-case';
import { User } from '@domain/user/user.entity';

describe('GetUserByIdUseCase', () => {
  const repo = { findById: jest.fn() };
  const useCase = new GetUserByIdUseCase(repo as any);

  it('returns the public profile', async () => {
    repo.findById.mockResolvedValue(
      new User('1', 'A', 'B', 20, 'a@test.com', 'secret', null),
    );
    const result = await useCase.execute('1');
    expect(result.id).toBe('1');
    expect(result).not.toHaveProperty('password');
  });

  it('throws NotFoundException for an unknown or malformed id', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(useCase.execute('nope')).rejects.toThrow(NotFoundException);
  });
});
