import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import {
  PmAdminAuth,
  PmAdminGuard,
} from '@infrastructure/http/pm-admin/pm-admin.auth';

const config = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);

describe('PmAdminAuth', () => {
  const jwt = new JwtService({});
  const links = { issue: jest.fn(), consume: jest.fn() };
  const auth = new PmAdminAuth(
    config({ JWT_SECRET: 's3cret', TELEGRAM_OWNER_ID: '42' }),
    jwt,
    links,
  );

  it('turns a valid one-time link into a session only the owner holds', async () => {
    links.consume.mockResolvedValueOnce(true);
    const session = await auth.login('token-from-the-bot-1234567890');
    expect(session).toEqual(expect.any(String));
    expect(auth.verify(session as string)).toBe(42);

    links.consume.mockResolvedValueOnce(false);
    await expect(auth.login('used-or-expired-1234567890')).resolves.toBeNull();
  });

  it('rejects other tokens: user API tokens, other subjects, other secrets', () => {
    const userToken = jwt.sign(
      { sub: '42', typ: 'access' },
      { secret: 's3cret' },
    );
    const otherUser = jwt.sign(
      { sub: '7', typ: 'pm-admin' },
      { secret: 's3cret' },
    );
    const forged = jwt.sign(
      { sub: '42', typ: 'pm-admin' },
      { secret: 'guess' },
    );
    expect(auth.verify(userToken)).toBeNull();
    expect(auth.verify(otherUser)).toBeNull();
    expect(auth.verify(forged)).toBeNull();
    expect(auth.verify('garbage')).toBeNull();
  });

  it('is closed when the owner or the secret is not configured', async () => {
    const closed = new PmAdminAuth(
      config({ JWT_SECRET: 's3cret' }),
      jwt,
      links,
    );
    links.consume.mockResolvedValue(true);
    await expect(
      closed.login('token-from-the-bot-1234567890'),
    ).resolves.toBeNull();
  });

  it('guards routes with the bearer session', () => {
    const guard = new PmAdminGuard(auth);
    const ctx = (authorization?: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization } }),
        }),
      } as any);
    const good = jwt.sign({ sub: '42', typ: 'pm-admin' }, { secret: 's3cret' });
    expect(guard.canActivate(ctx(`Bearer ${good}`))).toBe(true);
    expect(() => guard.canActivate(ctx())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx('Basic abc'))).toThrow(
      UnauthorizedException,
    );
  });
});
