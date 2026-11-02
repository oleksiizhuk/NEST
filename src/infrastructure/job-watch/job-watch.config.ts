import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_JOB_KEYWORDS,
  IJobWatchConfig,
} from '@application/job-watch/job-watch.config.interface';

const list = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

// Which boards, places and roles are personal, so they live in env only
export const jobWatchConfig = (config: ConfigService): IJobWatchConfig => {
  const keywords = list(config.get<string>('JOB_WATCH_KEYWORDS'));
  const chatId = Number(
    config.get<string>('JOB_WATCH_CHAT_ID') ||
      config.get<string>('TELEGRAM_OWNER_ID'),
  );
  return {
    boards: list(config.get<string>('JOB_WATCH_BOARDS')),
    locations: list(config.get<string>('JOB_WATCH_LOCATIONS')),
    keywords: keywords.length ? keywords : DEFAULT_JOB_KEYWORDS,
    chatId: Number.isFinite(chatId) ? chatId : 0,
  };
};
