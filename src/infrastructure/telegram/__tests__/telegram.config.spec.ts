import { ConfigService } from '@nestjs/config';
import { telegramConfig } from '@infrastructure/telegram/telegram.config';

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] } as ConfigService);

describe('telegramConfig', () => {
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
