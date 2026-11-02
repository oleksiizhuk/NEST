import { ConfigService } from '@nestjs/config';
import { jobWatchConfig } from '@infrastructure/job-watch/job-watch.config';
import { DEFAULT_JOB_KEYWORDS } from '@application/job-watch/job-watch.config.interface';

const configOf = (env: Record<string, string>) =>
  jobWatchConfig(new ConfigService(env));

describe('jobWatchConfig', () => {
  it('reads lists and falls back to the owner and default keywords', () => {
    expect(
      configOf({
        JOB_WATCH_BOARDS: ' acme, other ',
        JOB_WATCH_LOCATIONS: 'Berlin,',
        TELEGRAM_OWNER_ID: '7',
      }),
    ).toEqual({
      boards: ['acme', 'other'],
      locations: ['Berlin'],
      keywords: DEFAULT_JOB_KEYWORDS,
      chatId: 7,
    });
  });

  it('accepts "owner" and an explicit chat', () => {
    expect(
      configOf({ JOB_WATCH_CHAT_ID: 'owner', TELEGRAM_OWNER_ID: '7' }).chatId,
    ).toBe(7);
    expect(
      configOf({ JOB_WATCH_CHAT_ID: '-100123', TELEGRAM_OWNER_ID: '7' }).chatId,
    ).toBe(-100123);
  });

  it('is off when no chat can be worked out', () => {
    expect(configOf({ JOB_WATCH_CHAT_ID: 'nope' }).chatId).toBe(0);
    expect(configOf({}).chatId).toBe(0);
  });
});
