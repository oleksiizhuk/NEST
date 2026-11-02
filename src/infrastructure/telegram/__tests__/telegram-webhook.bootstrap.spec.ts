import { Logger } from '@nestjs/common';
import {
  OWNER_COMMANDS,
  resolveWebhookUrl,
  TelegramWebhookBootstrap,
} from '@infrastructure/telegram/telegram-webhook.bootstrap';

const env = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] } as any);

const prod = {
  VERCEL_ENV: 'production',
  TELEGRAM_TOKEN: '1:abc',
  VERCEL_PROJECT_PRODUCTION_URL: 'nest-ruby-theta.vercel.app',
};

describe('TelegramWebhookBootstrap', () => {
  const botService = {
    registerWebhook: jest.fn(),
    setChatCommands: jest.fn(),
  };
  const config = {
    mode: 'webhook',
    webhookSecret: 's3cret',
    ownerId: 555,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    botService.registerWebhook.mockResolvedValue({
      url: '',
      pending: 3,
      lastError: null,
    });
    botService.setChatCommands.mockResolvedValue(true);
  });

  const run = (values: Record<string, string | undefined>, cfg = config) =>
    new TelegramWebhookBootstrap(
      botService as any,
      env(values),
      cfg,
    ).onModuleInit();

  it('registers the production webhook with the shared secret', async () => {
    await run(prod);
    expect(botService.registerWebhook).toHaveBeenCalledWith(
      'https://nest-ruby-theta.vercel.app/telegram/webhook',
      's3cret',
    );
  });

  it("puts /report in the owner's private menu only", async () => {
    await run(prod);
    expect(botService.setChatCommands).toHaveBeenCalledWith(
      555,
      OWNER_COMMANDS,
    );
    expect(OWNER_COMMANDS.map((c) => c.command)).toContain('report');
    // Telegram's rules: lowercase name, no slash, short description
    for (const c of OWNER_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });

  it('sets no menu without an owner, and never fails the boot over it', async () => {
    await run(prod, { ...config, ownerId: 0 });
    expect(botService.setChatCommands).not.toHaveBeenCalled();
    botService.setChatCommands.mockRejectedValue(
      new Error('400 chat not found'),
    );
    await expect(run(prod)).resolves.toBeUndefined();
    // The webhook still got registered
    expect(botService.registerWebhook).toHaveBeenCalledTimes(2);
  });

  it('leaves the webhook alone on previews and locally', async () => {
    await run({ ...prod, VERCEL_ENV: 'preview' });
    await run({ ...prod, VERCEL_ENV: undefined });
    expect(botService.registerWebhook).not.toHaveBeenCalled();
    expect(botService.setChatCommands).not.toHaveBeenCalled();
  });

  it('does nothing in polling mode or without a token or secret', async () => {
    await run(prod, { ...config, mode: 'polling' });
    await run({ ...prod, TELEGRAM_TOKEN: undefined });
    await run(prod, { ...config, webhookSecret: '' });
    expect(botService.registerWebhook).not.toHaveBeenCalled();
  });

  describe('when sibling instances register at the same time', () => {
    const logs = () => ({
      log: jest.spyOn(Logger.prototype, 'log').mockImplementation(),
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(),
    });
    afterEach(() => jest.restoreAllMocks());

    it('a 429 is not an error once the webhook points at us', async () => {
      const spy = logs();
      botService.registerWebhook.mockResolvedValue({
        url: 'https://nest-ruby-theta.vercel.app/telegram/webhook',
        pending: 0,
        lastError: null,
        rateLimited: true,
        registered: true,
      });
      botService.setChatCommands.mockRejectedValue(
        Object.assign(new Error('429'), {
          error_code: 429,
          parameters: { retry_after: 1 },
        }),
      );
      await run(prod);
      expect(spy.error).not.toHaveBeenCalled();
      expect(spy.warn).not.toHaveBeenCalled();
      expect(spy.log).toHaveBeenCalledWith(
        expect.stringContaining('by another instance'),
      );
      expect(spy.log).toHaveBeenCalledWith(
        expect.stringContaining('another instance is setting it'),
      );
    });

    it('stays an error when the webhook is not ours', async () => {
      const spy = logs();
      botService.registerWebhook.mockResolvedValue({
        url: 'https://elsewhere/hook',
        pending: 0,
        lastError: null,
        rateLimited: true,
        registered: false,
      });
      botService.setChatCommands.mockRejectedValue(new Error('400 bad'));
      await run(prod);
      expect(spy.error).toHaveBeenCalledWith(
        expect.stringContaining('points at https://elsewhere/hook'),
      );
      expect(spy.warn).toHaveBeenCalledWith(
        expect.stringContaining('menu not set'),
      );
    });
  });

  it('never fails the boot when Telegram errors', async () => {
    botService.registerWebhook.mockRejectedValue(new Error('401 Unauthorized'));
    await expect(run(prod)).resolves.toBeUndefined();
  });
});

describe('resolveWebhookUrl', () => {
  it('prefers an explicit TELEGRAM_WEBHOOK_URL', () => {
    expect(
      resolveWebhookUrl(
        env({ ...prod, TELEGRAM_WEBHOOK_URL: 'https://example.com/hook' }),
      ),
    ).toBe('https://example.com/hook');
  });

  it('returns null when nothing tells it the public host', () => {
    expect(resolveWebhookUrl(env({}))).toBeNull();
  });
});
