import { ConfigService } from '@nestjs/config';
import { telegramConfig } from '@infrastructure/telegram/telegram.config';

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] } as ConfigService);

describe('telegramConfig', () => {
  it('parses a single allowed chat id', () => {
    const config = telegramConfig(
      configWith({ TELEGRAM_ALLOWED_CHAT_ID: '-1001234' }),
    );

    expect(config.allowedChatIds).toEqual([-1001234]);
  });

  it('parses a comma-separated list and tolerates spacing', () => {
    const config = telegramConfig(
      configWith({ TELEGRAM_ALLOWED_CHAT_ID: '-1001234, -1005678 ,-42' }),
    );

    expect(config.allowedChatIds).toEqual([-1001234, -1005678, -42]);
  });

  it('drops empty and non-numeric entries', () => {
    const config = telegramConfig(
      configWith({ TELEGRAM_ALLOWED_CHAT_ID: '-100,,оце не число,-200' }),
    );

    expect(config.allowedChatIds).toEqual([-100, -200]);
  });

  it('yields no allowed groups when unset', () => {
    expect(telegramConfig(configWith({})).allowedChatIds).toEqual([]);
  });

  it('parses the history cutoff', () => {
    const config = telegramConfig(
      configWith({ TELEGRAM_HISTORY_SINCE: '2026-07-29T17:00:00Z' }),
    );

    expect(config.historySince).toEqual(new Date('2026-07-29T17:00:00Z'));
  });

  it('keeps the full history when the cutoff is unset or unparseable', () => {
    expect(telegramConfig(configWith({})).historySince).toBeNull();
    expect(
      telegramConfig(configWith({ TELEGRAM_HISTORY_SINCE: 'вчора' }))
        .historySince,
    ).toBeNull();
  });

  it('defaults to webhook mode unless polling is requested', () => {
    expect(telegramConfig(configWith({})).mode).toBe('webhook');
    expect(telegramConfig(configWith({ TELEGRAM_MODE: 'polling' })).mode).toBe(
      'polling',
    );
  });
});
