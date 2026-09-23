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
  team: [] as string[],
  dmUsernames: [] as string[],
};
const source = (
  name: 'issues' | 'docs' | 'code',
  result: string | Error | { text: string; metrics?: Record<string, number> },
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
  findLatestBefore: jest.fn().mockResolvedValue(null),
  saveDigest: jest.fn().mockResolvedValue(undefined),
  findLastDigest: jest.fn().mockResolvedValue(null),
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

  it('puts the change since yesterday and since a week ago on top of a section', async () => {
    const snapshots = repo();
    const at = (iso: string, open: number) =>
      new ProjectSnapshot(iso, new Date(iso), [
        {
          source: 'issues',
          ok: true,
          fetchedAt: new Date(iso),
          text: 'old',
          error: null,
          metrics: { open, stale: 2 },
        },
      ]);
    snapshots.findLatest.mockResolvedValue(null);
    snapshots.findLatestBefore.mockImplementation(async (d: Date) =>
      d.getTime() === Date.UTC(2026, 8, 23)
        ? at('2026-09-22T05:00:00Z', 40)
        : at('2026-09-16T05:00:00Z', 35),
    );
    const useCase = new RefreshProjectSnapshotUseCase(
      [
        source('issues', {
          text: 'metrics block',
          metrics: { open: 44, stale: 2 },
        }),
      ] as any,
      snapshots as any,
    );

    const [section] = (await useCase.execute(now)).sections;

    expect(section.metrics).toEqual({ open: 44, stale: 2 });
    expect(section.text).toBe(
      '## Trend (computed)\n' +
        'Since 2026-09-22: open items 40 → 44 (+4)\n' +
        'Since 2026-09-16: open items 35 → 44 (+9)\n\n' +
        'metrics block',
    );
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
const staging = { tiers: () => [], roles: () => [], target: jest.fn() };
const collab = {
  isConfigured: () => false,
  fileKeys: () => [],
  recentComments: jest.fn(),
  getIssue: jest.fn(),
  getNodes: jest.fn(),
  imageLink: jest.fn(),
};
const actions = {
  create: jest.fn(),
  claim: jest.fn(),
  latestPending: jest.fn(),
  recent: jest.fn(),
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
      collab as any,
      collab as any,
      collab as any,
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
      'staging_get_brand',
      'propose_brand_action',
      'propose_update_store',
      'propose_create_property',
      'propose_property_action',
      'offer_choices',
    ]);
    expect(request.question).toBe(
      'Today is Wednesday 2026-09-23. Release date 2026-09-30: 5 working days left.\n\nA: how are we doing?',
    );
  });

  it('builds a snapshot inline only when there is none at all', async () => {
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
      collab as any,
      collab as any,
      collab as any,
    );
    await useCase.execute('q', [], { chatId: 1, requesterId: 1 }, now);
    expect(refresh.execute).toHaveBeenCalledWith(now);
  });

  it('answers from a stale snapshot instead of rebuilding it inside the webhook', async () => {
    const snapshots = repo();
    snapshots.findLatest.mockResolvedValue(
      new ProjectSnapshot('old', new Date('2026-09-20T05:00:00Z'), []),
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
      collab as any,
      collab as any,
      collab as any,
    );
    const started = Date.now();
    await useCase.execute('q', [], { chatId: 1, requesterId: 1 }, now);
    expect(refresh.execute).not.toHaveBeenCalled();
    const request = ai.answer.mock.calls[ai.answer.mock.calls.length - 1][0];
    expect(request.deadline).toBeGreaterThanOrEqual(started + 239_000);
    expect(request.deadline).toBeLessThanOrEqual(Date.now() + 240_000);
    request.tools.close();
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
    answerCallback: jest.fn().mockResolvedValue(undefined),
    clearButtons: jest.fn().mockResolvedValue(undefined),
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

  it('shows the previous digest to the model and stores the new one', async () => {
    const snapshots = repo();
    snapshots.findLastDigest.mockResolvedValue({
      createdAt: new Date('2026-09-22T05:00:00Z'),
      text: 'yesterday: AT RISK',
    });
    const useCase = new PostDailyDigestUseCase(
      refresh as any,
      ai as any,
      telegram,
      config,
      chats([]),
      knowledge as any,
      snapshots as any,
    );
    await useCase.execute(now);
    expect(snapshots.findLastDigest).toHaveBeenCalledWith(now);
    expect(ai.digest.mock.calls[0][0].history).toEqual([
      {
        userText: expect.stringContaining('(2026-09-22)'),
        botResponse: 'yesterday: AT RISK',
      },
    ]);
    expect(snapshots.saveDigest).toHaveBeenCalledWith('r', 'digest text');
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
