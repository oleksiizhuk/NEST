import {
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
  const botService = { registerWebhook: jest.fn() };
  const config = { mode: 'webhook', webhookSecret: 's3cret' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    botService.registerWebhook.mockResolvedValue({
      url: '',
      pending: 3,
      lastError: null,
    });
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

  it('leaves the webhook alone on previews and locally', async () => {
    await run({ ...prod, VERCEL_ENV: 'preview' });
    await run({ ...prod, VERCEL_ENV: undefined });
    expect(botService.registerWebhook).not.toHaveBeenCalled();
  });

  it('does nothing in polling mode or without a token or secret', async () => {
    await run(prod, { ...config, mode: 'polling' });
    await run({ ...prod, TELEGRAM_TOKEN: undefined });
    await run(prod, { ...config, webhookSecret: '' });
    expect(botService.registerWebhook).not.toHaveBeenCalled();
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
