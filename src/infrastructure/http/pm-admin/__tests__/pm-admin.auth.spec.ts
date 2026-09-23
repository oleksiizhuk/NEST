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
  let epoch = 0;
  const settings = {
    get: jest.fn(),
    save: jest.fn(),
    sessionEpoch: jest.fn(async () => epoch),
    bumpSessionEpoch: jest.fn(async () => ++epoch),
  };
  const auth = new PmAdminAuth(
    config({ JWT_SECRET: 's3cret', TELEGRAM_OWNER_ID: '42' }),
    jwt,
    links,
    settings,
  );
  const sign = (payload: object, secret = 's3cret') =>
    jwt.sign(payload, { secret });

  beforeEach(() => {
    epoch = 0;
  });

  it('turns a valid one-time link into a session only the owner holds', async () => {
    links.consume.mockResolvedValueOnce(true);
    const session = await auth.login('token-from-the-bot-1234567890');
    expect(session).toEqual(expect.any(String));
    await expect(auth.verify(session as string)).resolves.toBe(42);

    links.consume.mockResolvedValueOnce(false);
    await expect(auth.login('used-or-expired-1234567890')).resolves.toBeNull();
  });

  it('logs every session out when the owner asks', async () => {
    links.consume.mockResolvedValueOnce(true);
    const session = (await auth.login(
      'token-from-the-bot-1234567890',
    )) as string;
    await auth.revokeAll();
    await expect(auth.verify(session)).resolves.toBeNull();
  });

  it('rejects other tokens: user API tokens, other subjects, other secrets', async () => {
    await expect(
      auth.verify(sign({ sub: '42', typ: 'access', v: 0 })),
    ).resolves.toBeNull();
    await expect(
      auth.verify(sign({ sub: '7', typ: 'pm-admin', v: 0 })),
    ).resolves.toBeNull();
    await expect(
      auth.verify(sign({ sub: '42', typ: 'pm-admin', v: 0 }, 'guess')),
    ).resolves.toBeNull();
    await expect(auth.verify('garbage')).resolves.toBeNull();
  });

  it('is closed when the owner or the secret is not configured', async () => {
    const closed = new PmAdminAuth(
      config({ JWT_SECRET: 's3cret' }),
      jwt,
      links,
      settings,
    );
    links.consume.mockResolvedValue(true);
    await expect(
      closed.login('token-from-the-bot-1234567890'),
    ).resolves.toBeNull();
  });

  it('guards routes with the bearer session', async () => {
    const guard = new PmAdminGuard(auth);
    const ctx = (authorization?: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers: { authorization } }),
        }),
      } as any);
    const good = sign({ sub: '42', typ: 'pm-admin', v: 0 });
    await expect(guard.canActivate(ctx(`Bearer ${good}`))).resolves.toBe(true);
    await expect(guard.canActivate(ctx())).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(guard.canActivate(ctx('Basic abc'))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
