import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { AnswerProjectQuestionUseCase } from '@application/project-manager/use-cases/answer-project-question.use-case';
import { PostDailyDigestUseCase } from '@application/project-manager/use-cases/post-daily-digest.use-case';

const now = new Date('2026-09-23T06:00:00Z');
const config = {
  chatIds: [1],
  digestChatId: -100 as number | null,
  releaseDate: '2026-09-30',
  projectBrief: 'Team: A (mobile)',
  maxSnapshotAgeHours: 30,
  actionUserIds: [] as number[],
};
const source = (
  name: 'issues' | 'docs' | 'code',
  result: string | Error,
  configured = true,
) => ({
  source: name,
  isConfigured: () => configured,
  fetch: jest.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  ),
});
const repo = () => ({
  save: jest.fn(async (sections) => new ProjectSnapshot('new', now, sections)),
  findLatest: jest.fn(),
});

describe('RefreshProjectSnapshotUseCase', () => {
  it('keeps the previous text of a failed source and skips unconfigured ones', async () => {
    const snapshots = repo();
    const old = new Date('2026-09-22T06:00:00Z');
    snapshots.findLatest.mockResolvedValue(
      new ProjectSnapshot('old', old, [
        {
          source: 'code',
          ok: true,
          fetchedAt: old,
          text: 'yesterday PRs',
          error: null,
        },
      ]),
    );
    const useCase = new RefreshProjectSnapshotUseCase(
      [
        source('issues', 'ABC-1 | Open'),
        source('code', new Error('github responded 500')),
        source('docs', 'unused', false),
      ] as any,
      snapshots as any,
    );

    const snapshot = await useCase.execute(now);

    expect(snapshot.sections).toEqual([
      {
        source: 'issues',
        ok: true,
        fetchedAt: now,
        text: 'ABC-1 | Open',
        error: null,
      },
      {
        source: 'code',
        ok: false,
        fetchedAt: old,
        text: 'yesterday PRs',
        error: 'github responded 500',
      },
    ]);
  });
});

const knowledge = {
  all: jest
    .fn()
    .mockResolvedValue([{ key: 'map:api', text: 'API map', updatedAt: now }]),
  upsert: jest.fn(),
  remove: jest.fn(),
};
const code = {
  isConfigured: () => true,
  repos: () => ['api'],
  searchCode: jest.fn(),
  readFile: jest.fn(),
  listDir: jest.fn(),
  pullRequest: jest.fn(),
};
const staging = {
  isConfigured: () => false,
  describeTarget: () => 'staging',
  findMalls: jest.fn(),
  findCategories: jest.fn(),
  findBrands: jest.fn(),
  createBrand: jest.fn(),
};
const actions = {
  create: jest.fn(),
  claim: jest.fn(),
  latestPending: jest.fn(),
  finish: jest.fn(),
  cancel: jest.fn(),
};

describe('AnswerProjectQuestionUseCase', () => {
  const ai = {
    answer: jest.fn().mockResolvedValue('ON TRACK'),
    digest: jest.fn(),
  };
  const refresh = { execute: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it('answers from a fresh snapshot with the date line in front of the question', async () => {
    const snapshots = repo();
    snapshots.findLatest.mockResolvedValue(
      new ProjectSnapshot('s', new Date('2026-09-23T05:00:00Z'), []),
    );
    const useCase = new AnswerProjectQuestionUseCase(
      snapshots as any,
      refresh as any,
      ai as any,
      config,
      knowledge as any,
      code as any,
      staging as any,
      actions as any,
    );

    await useCase.execute(
      'A: how are we doing?',
      [],
      { chatId: 1, requesterId: 1 },
      now,
    );

    expect(refresh.execute).not.toHaveBeenCalled();
    const request = ai.answer.mock.calls[0][0];
    expect(request.brief).toBe('Team: A (mobile)');
    expect(request.knowledge).toBe('<doc key="map:api">\nAPI map\n</doc>');
    expect(request.tools.specs.map((t: { name: string }) => t.name)).toEqual([
      'search_code',
      'read_file',
      'list_dir',
      'get_pull_request',
      'staging_lookup',
      'propose_create_brand',
    ]);
    expect(request.question).toBe(
      'Today is Wednesday 2026-09-23. Release date 2026-09-30: 5 working days left.\n\nA: how are we doing?',
    );
  });

  it('rebuilds a stale or missing snapshot before answering', async () => {
    const snapshots = repo();
    snapshots.findLatest.mockResolvedValue(null);
    refresh.execute.mockResolvedValue(new ProjectSnapshot('r', now, []));
    const useCase = new AnswerProjectQuestionUseCase(
      snapshots as any,
      refresh as any,
      ai as any,
      config,
      knowledge as any,
      code as any,
      staging as any,
      actions as any,
    );

    await useCase.execute('q', [], { chatId: 1, requesterId: 1 }, now);

    expect(refresh.execute).toHaveBeenCalledWith(now);
  });
});

const chats = (ids: number[]) => ({
  isEnabled: jest.fn(),
  enable: jest.fn(),
  disable: jest.fn(),
  digestChats: jest.fn().mockResolvedValue(ids),
});

describe('PostDailyDigestUseCase', () => {
  const ai = {
    answer: jest.fn(),
    digest: jest.fn().mockResolvedValue('digest text'),
  };
  const telegram = {
    sendMessage: jest.fn(),
    sendTyping: jest.fn(),
    getBotInfo: jest.fn(),
  };
  const refresh = {
    execute: jest.fn().mockResolvedValue(new ProjectSnapshot('r', now, [])),
  };
  beforeEach(() => jest.clearAllMocks());

  it('refreshes, writes the digest and posts it to the digest chat', async () => {
    const useCase = new PostDailyDigestUseCase(
      refresh as any,
      ai as any,
      telegram,
      config,
      chats([]),
      knowledge as any,
    );
    await expect(useCase.execute(now)).resolves.toEqual({ posted: true });
    expect(refresh.execute).toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(-100, 'digest text');
  });

  it('only refreshes when no digest chat is configured', async () => {
    const useCase = new PostDailyDigestUseCase(
      refresh as any,
      ai as any,
      telegram,
      {
        ...config,
        digestChatId: null,
      },
      chats([]),
      knowledge as any,
    );
    await expect(useCase.execute(now)).resolves.toEqual({ posted: false });
    expect(ai.digest).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('also posts to chats switched on with /pm_on, once each', async () => {
    const useCase = new PostDailyDigestUseCase(
      refresh as any,
      ai as any,
      telegram,
      config,
      chats([-100, -300]),
      knowledge as any,
    );
    await useCase.execute(now);
    expect(
      telegram.sendMessage.mock.calls.map((c) => c[0]).sort((a, b) => a - b),
    ).toEqual([-300, -100]);
  });
});
