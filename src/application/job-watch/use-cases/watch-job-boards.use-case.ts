import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IJobBoard,
  JOB_BOARD,
  JobPosting,
} from '@application/job-watch/job-board.interface';
import {
  ISeenJobs,
  SEEN_JOBS,
} from '@application/job-watch/seen-jobs.interface';
import {
  IJobWatchConfig,
  JOB_WATCH_CONFIG,
} from '@application/job-watch/job-watch.config.interface';
import { matchJob } from '@application/job-watch/job-match';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';

export interface JobMatch {
  board: string;
  id: string;
  title: string;
  location: string;
  keywords: string[];
  url: string;
}

export interface JobWatchResult {
  off: boolean;
  dry: boolean;
  boards: { board: string; jobs: number; error?: string }[];
  matches: JobMatch[];
  // Matches announced by this run (new since the earlier runs)
  sent: number;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

// One posting as a Telegram message: what, where, which keywords, the link
export const jobMessage = (job: JobPosting, match: JobMatch): string =>
  [
    `🆕 Вакансия (${match.board}): ${oneLine(job.title)}`,
    `📍 ${[match.location, job.workplaceType, job.department]
      .filter(Boolean)
      .join(' · ')}`,
    `Совпало: ${match.keywords.join(', ')}`,
    job.url,
  ].join('\n');

// Vercel Cron, once a day: read every configured board, announce each
// matching posting once. No model call.
@Injectable()
export class WatchJobBoardsUseCase {
  private readonly logger = new Logger(WatchJobBoardsUseCase.name);

  constructor(
    @Inject(JOB_BOARD) private readonly board: IJobBoard,
    @Inject(SEEN_JOBS) private readonly seen: ISeenJobs,
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(JOB_WATCH_CONFIG) private readonly config: IJobWatchConfig,
  ) {}

  async execute(now: Date, dry = false): Promise<JobWatchResult> {
    const { boards, chatId } = this.config;
    const result: JobWatchResult = {
      off: !boards.length || !chatId,
      dry,
      boards: [],
      matches: [],
      sent: 0,
    };
    if (result.off) return result;

    const found: { job: JobPosting; match: JobMatch }[] = [];
    for (const slug of boards) {
      let jobs: JobPosting[];
      try {
        jobs = await this.board.list(slug);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.boards.push({ board: slug, jobs: 0, error: message });
        continue;
      }
      result.boards.push({ board: slug, jobs: jobs.length });
      for (const job of jobs) {
        const keywords = matchJob(job, this.config);
        if (!keywords) continue;
        const match: JobMatch = {
          board: slug,
          id: job.id,
          title: oneLine(job.title),
          location: job.locations[0] ?? '',
          keywords,
          url: job.url,
        };
        found.push({ job, match });
        result.matches.push(match);
      }
    }
    if (dry) return result;

    for (const { job, match } of found) {
      const key = `${match.board}:${match.id}`;
      if (!(await this.seen.claim(key, now))) continue;
      try {
        await this.telegram.sendMessage(
          chatId,
          jobMessage(job, match),
          undefined,
          {
            links: false,
          },
        );
        result.sent++;
      } catch (error) {
        this.logger.error(`job ${key} not sent: ${error}`);
        await this.seen
          .release(key)
          .catch((e) => this.logger.error(`job ${key} release: ${e}`));
      }
    }

    // A board that cannot be read looks exactly like a board with nothing
    // new, so say so instead of going quiet
    const broken = result.boards.filter((b) => b.error);
    if (broken.length) {
      await this.telegram
        .sendMessage(
          chatId,
          `⚠️ Не смог прочитать вакансии: ${broken
            .map((b) => `${b.board} (${b.error})`)
            .join('; ')}`,
          undefined,
          { links: false },
        )
        .catch((e) => this.logger.error(`job watch notice: ${e}`));
    }
    return result;
  }
}
