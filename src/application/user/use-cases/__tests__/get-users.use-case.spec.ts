import { GetUsersUseCase } from '@application/user/use-cases/get-users.use-case';
import { User } from '@domain/user/user.entity';

describe('GetUsersUseCase', () => {
  it('returns public profiles only', async () => {
    const repo = {
      findAll: jest
        .fn()
        .mockResolvedValue([
          new User('1', 'A', 'B', 20, 'a@test.com', 'secret', null),
          new User('2', 'C', 'D', 30, 'c@test.com', 'secret', 'cart'),
        ]),
    };
    const result = await new GetUsersUseCase(repo as any).execute();
    expect(result).toHaveLength(2);
    result.forEach((u) => expect(u).not.toHaveProperty('password'));
  });
});
