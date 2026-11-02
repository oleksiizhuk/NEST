import { WatchJobBoardsUseCase } from '@application/job-watch/use-cases/watch-job-boards.use-case';
import {
  IJobBoard,
  JobPosting,
} from '@application/job-watch/job-board.interface';
import { ISeenJobs } from '@application/job-watch/seen-jobs.interface';
import { IJobWatchConfig } from '@application/job-watch/job-watch.config.interface';
import { ITelegramGateway } from '@application/telegram/telegram.gateway.interface';

const posting = (id: string, title: string, place = 'Berlin, Germany') =>
  ({
    id,
    title,
    locations: [place],
    department: 'Engineering',
    team: '',
    workplaceType: 'Hybrid',
    url: `https://example.test/${id}`,
    publishedAt: null,
  } as JobPosting);

const config: IJobWatchConfig = {
  boards: ['acme'],
  locations: ['Berlin'],
  keywords: ['react native', 'mobile'],
  chatId: 42,
};

const setup = (
  jobs: JobPosting[] | Error,
  over: Partial<IJobWatchConfig> = {},
) => {
  const claimed = new Set<string>();
  const board: IJobBoard = {
    list: jest.fn(async () => {
      if (jobs instanceof Error) throw jobs;
      return jobs;
    }),
  };
  const seen: jest.Mocked<ISeenJobs> = {
    claim: jest.fn<Promise<boolean>, [string, Date]>(async (key) => {
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
    release: jest.fn<Promise<void>, [string]>(async (key) => {
      claimed.delete(key);
    }),
  };
  const telegram = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ITelegramGateway>;
  const useCase = new WatchJobBoardsUseCase(board, seen, telegram, {
    ...config,
    ...over,
  });
  return { useCase, board, seen, telegram };
};

const now = new Date('2026-11-02T07:00:00Z');

describe('WatchJobBoardsUseCase', () => {
  it('announces each new match once', async () => {
    const { useCase, telegram } = setup([
      posting('a', 'Senior React Native Developer'),
      posting('b', 'Staff Backend Engineer'),
      posting('c', 'Mobile Engineer', 'Lisbon, Portugal'),
    ]);

    const first = await useCase.execute(now);
    expect(first.sent).toBe(1);
    expect(first.matches.map((m) => m.id)).toEqual(['a']);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, , options] = telegram.sendMessage.mock.calls[0];
    expect(chatId).toBe(42);
    expect(text).toContain('Senior React Native Developer');
    expect(text).toContain('Berlin, Germany');
    expect(text).toContain('https://example.test/a');
    expect(options).toEqual({ links: false });

    const second = await useCase.execute(now);
    expect(second.sent).toBe(0);
    expect(second.matches).toHaveLength(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('dry run lists matches without sending or recording', async () => {
    const { useCase, telegram, seen } = setup([
      posting('a', 'Mobile Developer'),
    ]);
    const result = await useCase.execute(now, true);
    expect(result.dry).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(seen.claim).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('stops at a Telegram failure and sends the rest next run', async () => {
    const { useCase, telegram, seen } = setup([
      posting('a', 'Mobile Developer'),
      posting('b', 'React Native Developer'),
    ]);
    telegram.sendMessage.mockRejectedValueOnce(new Error('429'));
    const first = await useCase.execute(now);
    expect(first.sent).toBe(0);
    expect(seen.release).toHaveBeenCalledWith('acme:a');
    // The second one was not even claimed
    expect(seen.claim).toHaveBeenCalledTimes(1);

    const second = await useCase.execute(now);
    expect(second.sent).toBe(2);
  });

  it('says so when the store is down, claiming nothing', async () => {
    const { useCase, telegram, seen } = setup([
      posting('a', 'Mobile Developer'),
    ]);
    seen.claim.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await useCase.execute(now);
    expect(result.sent).toBe(0);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain('ECONNREFUSED');
  });

  it('says so when a board cannot be read', async () => {
    const { useCase, telegram } = setup(new Error('Ashby responded 404'));
    const result = await useCase.execute(now);
    expect(result.boards).toEqual([
      { board: 'acme', jobs: 0, error: 'Ashby responded 404' },
    ]);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain(
      'Ashby responded 404',
    );
  });

  it('is off without boards or a chat', async () => {
    for (const over of [{ boards: [] }, { chatId: 0 }]) {
      const { useCase, board } = setup([posting('a', 'Mobile Dev')], over);
      const result = await useCase.execute(now);
      expect(result.off).toBe(true);
      expect(board.list).not.toHaveBeenCalled();
    }
  });
});
