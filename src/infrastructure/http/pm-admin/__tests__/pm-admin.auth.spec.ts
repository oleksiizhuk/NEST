import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
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
  let failures = 0;
  const throttle = {
    blocked: jest.fn(async () => failures >= 5),
    fail: jest.fn(async () => {
      failures += 1;
    }),
    reset: jest.fn(async () => {
      failures = 0;
    }),
  };
  const telegram = { sendMessage: jest.fn().mockResolvedValue(undefined) };
  const states = new Map<string, string>();
  let denied = false;
  const approvals = {
    create: jest.fn(async () => {
      const id = `${states.size}`.padStart(32, 'a');
      states.set(id, 'pending');
      return id;
    }),
    decide: jest.fn(async (id: string, ok: boolean) => {
      states.set(id, ok ? 'approved' : 'denied');
      if (!ok) denied = true;
      return states.get(id);
    }),
    take: jest.fn(async (id: string) => {
      const st = states.get(id) ?? 'unknown';
      if (st === 'approved') states.set(id, 'spent');
      return st === 'spent' ? 'unknown' : st;
    }),
    deniedSince: jest.fn(async () => denied),
  };
  const hash = bcrypt.hashSync('correct horse', 4);
  const auth = new PmAdminAuth(
    config({
      JWT_SECRET: 's3cret',
      TELEGRAM_OWNER_ID: '42',
      PM_ADMIN_EMAIL: 'Owner@Example.com',
      PM_ADMIN_PASSWORD_HASH: hash,
    }),
    jwt,
    links,
    settings,
    throttle as any,
    telegram as any,
    approvals as any,
  );
  const sign = (payload: object, secret = 's3cret') =>
    jwt.sign(payload, { secret });

  beforeEach(() => {
    epoch = 0;
    failures = 0;
    denied = false;
    states.clear();
    telegram.sendMessage.mockClear();
  });

  it('asks the owner in Telegram and issues the session once after "yes"', async () => {
    const started = await auth.loginWithPassword(
      ' owner@example.com ',
      'correct horse',
    );
    if (!('pending' in started)) throw new Error('expected pending');
    const [chat, text, buttons] = telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(42);
    expect(text).toContain('Это вы?');
    expect(buttons[0].map((b: { data: string }) => b.data)).toEqual([
      `a:+:${started.pending}`,
      `a:-:${started.pending}`,
    ]);
    await expect(auth.approval(started.pending)).resolves.toEqual({
      pending: true,
    });
    await approvals.decide(started.pending, true);
    const done = await auth.approval(started.pending);
    expect('session' in done && (await auth.verify(done.session))).toBe(42);
    // Spent: a second poll gets nothing
    await expect(auth.approval(started.pending)).resolves.toEqual({
      error: 'unknown',
    });
  });

  it('a "no" in Telegram refuses this login and locks the next ones', async () => {
    const started = await auth.loginWithPassword(
      'owner@example.com',
      'correct horse',
    );
    if (!('pending' in started)) throw new Error('expected pending');
    await approvals.decide(started.pending, false);
    await expect(auth.approval(started.pending)).resolves.toEqual({
      error: 'denied',
    });
    await expect(
      auth.loginWithPassword('owner@example.com', 'correct horse'),
    ).resolves.toEqual({ error: 'locked' });
  });

  it('fails closed when the Telegram prompt cannot be sent', async () => {
    telegram.sendMessage.mockRejectedValueOnce(new Error('403'));
    await expect(
      auth.loginWithPassword('owner@example.com', 'correct horse'),
    ).resolves.toEqual({ error: 'busy' });
  });

  it('refuses wrong credentials and locks after five failures', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(
        auth.loginWithPassword('owner@example.com', `guess ${i}`),
      ).resolves.toEqual({ error: 'invalid' });
    }
    await expect(
      auth.loginWithPassword('owner@example.com', 'correct horse'),
    ).resolves.toEqual({ error: 'locked' });
    await expect(
      auth.loginWithPassword('someone@else.com', 'correct horse'),
    ).resolves.toEqual({ error: 'locked' });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps password login off until email and hash are set', async () => {
    const off = new PmAdminAuth(
      config({ JWT_SECRET: 's3cret', TELEGRAM_OWNER_ID: '42' }),
      jwt,
      links,
      settings,
      throttle as any,
      telegram as any,
      approvals as any,
    );
    await expect(off.loginWithPassword('a@b.c', 'x')).resolves.toEqual({
      error: 'off',
    });
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
      throttle as any,
      telegram as any,
      approvals as any,
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
