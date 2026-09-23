import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenUseCase } from '@application/auth/use-cases/refresh-token.use-case';
import { User } from '@domain/user/user.entity';

const tokens = { accessToken: 'new-access', refreshToken: 'new-refresh' };

describe('RefreshTokenUseCase', () => {
  const tokenService = { verifyRefresh: jest.fn(), issue: jest.fn() };
  const repo = { findByEmail: jest.fn() };
  let useCase: RefreshTokenUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    tokenService.issue.mockReturnValue(tokens);
    useCase = new RefreshTokenUseCase(tokenService as any, repo as any);
  });

  it('issues a new pair for a valid refresh token of an existing user', async () => {
    tokenService.verifyRefresh.mockReturnValue({
      userId: 'id1',
      email: 'john@test.com',
    });
    repo.findByEmail.mockResolvedValue(
      new User('id1', 'J', 'D', 30, 'john@test.com', 'h', null),
    );
    await expect(useCase.execute('refresh')).resolves.toEqual(tokens);
    expect(tokenService.issue).toHaveBeenCalledWith({
      userId: 'id1',
      email: 'john@test.com',
    });
  });

  it('rejects a token that fails verification', async () => {
    tokenService.verifyRefresh.mockReturnValue(null);
    await expect(useCase.execute('forged')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(tokenService.issue).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    await expect(useCase.execute(undefined)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token for a deleted user', async () => {
    tokenService.verifyRefresh.mockReturnValue({
      userId: 'id1',
      email: 'gone@test.com',
    });
    repo.findByEmail.mockResolvedValue(null);
    await expect(useCase.execute('refresh')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token whose email now belongs to another account', async () => {
    tokenService.verifyRefresh.mockReturnValue({
      userId: 'old-owner',
      email: 'john@test.com',
    });
    repo.findByEmail.mockResolvedValue(
      new User('new-owner', 'J', 'D', 30, 'john@test.com', 'h', null),
    );
    await expect(useCase.execute('refresh')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(tokenService.issue).not.toHaveBeenCalled();
  });
});
