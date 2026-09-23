import { ConfigService } from '@nestjs/config';
import { IPmConfig } from '@application/project-manager/pm.config.interface';

// "owner" stands for TELEGRAM_OWNER_ID, i.e. the owner's private chat
const ids = (value: string | undefined, ownerId: number): number[] =>
  (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .map((v) => (v.toLowerCase() === 'owner' ? ownerId : Number(v)))
    .filter((n) => Number.isInteger(n) && n !== 0);

export const pmConfig = (config: ConfigService): IPmConfig => {
  const digest = Number(config.get<string>('PM_DIGEST_CHAT_ID'));
  const release = config.get<string>('PM_RELEASE_DATE') ?? '';
  const maxAge = Number(config.get<string>('PM_SNAPSHOT_MAX_AGE_HOURS'));
  return {
    chatIds: ids(
      config.get<string>('TELEGRAM_PM_CHAT_IDS'),
      Number(config.get<string>('TELEGRAM_OWNER_ID')),
    ),
    digestChatId: Number.isInteger(digest) && digest !== 0 ? digest : null,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(release) ? release : null,
    // Vercel env values are single-line; "\n" in the value means a newline
    projectBrief: (config.get<string>('PM_PROJECT_BRIEF') ?? '').replace(
      /\\n/g,
      '\n',
    ),
    maxSnapshotAgeHours: maxAge > 0 ? maxAge : 30,
  };
};
