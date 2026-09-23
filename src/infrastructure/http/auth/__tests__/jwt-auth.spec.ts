import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtTokenService } from '@infrastructure/http/auth/utils/jwt-token.service';
import { JwtStrategy } from '@infrastructure/http/auth/strategies/jwt.strategy';
import { getJwtSecret } from '@infrastructure/http/auth/constants/constants';
import { User } from '@domain/user/user.entity';

const subject = { userId: 'u1', email: 'john@test.com' };

describe('JWT auth', () => {
  const OLD = process.env.JWT_SECRET;
  beforeAll(() => (process.env.JWT_SECRET = 'test-secret'));
  afterAll(() => (process.env.JWT_SECRET = OLD));

  const service = () =>
    new JwtTokenService(new JwtService({ secret: 'test-secret' }));

  it('refuses to run without JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = 'test-secret';
  });

  it('accepts its own refresh token and returns the subject', () => {
    const { refreshToken } = service().issue(subject);
    expect(service().verifyRefresh(refreshToken)).toEqual(subject);
  });

  it('does not accept an access token as a refresh token', () => {
    const { accessToken } = service().issue(subject);
    expect(service().verifyRefresh(accessToken)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const forged = new JwtService({ secret: 'other' }).sign({
      sub: 'u1',
      email: 'john@test.com',
      typ: 'refresh',
    });
    expect(service().verifyRefresh(forged)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(service().verifyRefresh('not-a-jwt')).toBeNull();
  });

  describe('JwtStrategy', () => {
    const repo = { findByEmail: jest.fn() };
    const strategy = () => new JwtStrategy(repo as any);
    const owner = new User('u1', 'J', 'D', 30, 'john@test.com', 'h', null);

    beforeEach(() => repo.findByEmail.mockResolvedValue(owner));

    it('lets an access token of the current owner through', async () => {
      await expect(
        strategy().validate({
          sub: 'u1',
          email: 'john@test.com',
          typ: 'access',
        }),
      ).resolves.toEqual({ email: 'john@test.com' });
    });

    it('rejects a refresh token', async () => {
      await expect(
        strategy().validate({
          sub: 'u1',
          email: 'john@test.com',
          typ: 'refresh',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token issued before this change (no typ / sub)', async () => {
      await expect(
        strategy().validate({ email: 'john@test.com' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token whose email now belongs to another account', async () => {
      await expect(
        strategy().validate({
          sub: 'old-owner',
          email: 'john@test.com',
          typ: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token of a deleted account', async () => {
      repo.findByEmail.mockResolvedValue(null);
      await expect(
        strategy().validate({
          sub: 'u1',
          email: 'john@test.com',
          typ: 'access',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
