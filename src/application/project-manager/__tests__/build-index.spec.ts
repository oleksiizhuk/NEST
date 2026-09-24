import { BuildIndexUseCase } from '@application/project-manager/use-cases/build-index.use-case';
import {
  IndexDoc,
  IndexJobState,
} from '@application/project-manager/project-index.interface';
import { snippetOf } from '@infrastructure/database/repositories/mongo-project-index';
import { PmToolbox } from '@application/project-manager/tools/pm-toolbox';

const doc = (source: IndexDoc['source'], key: string): IndexDoc => ({
  source,
  key,
  title: key,
  url: null,
  meta: '',
  text: 't',
  updatedAt: null,
});

const setup = () => {
  let state: IndexJobState | null = null;
  const job = {
    get: jest.fn(async () =>
      state ? { ...state, counts: { ...state.counts } } : null,
    ),
    save: jest.fn(async (s: IndexJobState) => {
      state = { ...s, counts: { ...s.counts } };
    }),
  };
  const index = {
    upsert: jest.fn(),
    search: jest.fn(),
    get: jest.fn(),
    counts: jest.fn().mockResolvedValue({}),
    removeStale: jest.fn().mockResolvedValue(0),
  };
  const jira = {
    source: 'jira' as const,
    isConfigured: () => true,
    page: jest.fn(async (cursor: string | null) =>
      cursor === null
        ? { docs: [doc('jira', 'A-1'), doc('jira', 'A-2')], next: 'p2' }
        : { docs: [doc('jira', 'A-3')], next: null },
    ),
  };
  const figma = {
    source: 'figma' as const,
    isConfigured: () => false,
    page: jest.fn(),
  };
  const github = {
    source: 'github' as const,
    isConfigured: () => true,
    page: jest.fn(async () => ({ docs: [doc('github', 'api#1')], next: null })),
  };
  const useCase = new BuildIndexUseCase(index, job, [jira, figma, github]);
  return { useCase, index, jira, figma, github, state: () => state };
};

describe('BuildIndexUseCase', () => {
  it('collects every configured source page by page and prunes what is gone', async () => {
    const { useCase, index, figma, state } = setup();
    const started = await useCase.start(new Date('2026-09-24T01:00:00Z'));
    expect(started.stage).toBe('jira');
    const done = await useCase.step(60_000);
    expect(done.status).toBe('done');
    expect(done.counts).toEqual({ jira: 3, github: 1 });
    expect(index.upsert).toHaveBeenCalledTimes(3);
    expect(index.removeStale).toHaveBeenCalledWith('jira', started.runId);
    expect(index.removeStale).toHaveBeenCalledWith('github', started.runId);
    expect(figma.page).not.toHaveBeenCalled();
    expect(state()?.finishedAt).toBeInstanceOf(Date);
  });

  it('stops within its budget and continues where it stopped', async () => {
    const { useCase, jira } = setup();
    await useCase.start();
    const first = await useCase.step(0);
    expect(first.status).toBe('running');
    expect(jira.page).not.toHaveBeenCalled();
    const second = await useCase.step(60_000);
    expect(second.status).toBe('done');
  });

  it('records a failure with the source that failed', async () => {
    const { useCase, jira } = setup();
    jira.page.mockRejectedValueOnce(new Error('jira 503'));
    await useCase.start();
    const failed = await useCase.step(60_000);
    expect(failed).toMatchObject({ status: 'failed', error: 'jira: jira 503' });
  });
});

describe('snippetOf', () => {
  it('cuts around the first matching word', () => {
    const text = `${'x '.repeat(200)}оплата картой не проходит ${'y '.repeat(
      200,
    )}`;
    const s = snippetOf(text, 'картой');
    expect(s.startsWith('…')).toBe(true);
    expect(s).toContain('оплата картой');
  });
});

describe('search tools', () => {
  it('search the local copy and read one item', async () => {
    const index = {
      search: jest.fn().mockResolvedValue([
        {
          source: 'jira',
          key: 'KAN-1',
          title: 'KAN-1 Checkout',
          url: 'https://x/browse/KAN-1',
          meta: 'Story · In Progress · assignee Ann · by Faisal',
          snippet: 'pay by card',
          updatedAt: new Date('2026-09-20T00:00:00Z'),
        },
      ]),
      get: jest
        .fn()
        .mockResolvedValue({ ...doc('jira', 'KAN-1'), text: 'full text' }),
    };
    const toolbox = new PmToolbox(
      { repos: () => [], isConfigured: () => false } as any,
      { tiers: () => [], roles: () => [] } as any,
      {} as any,
      { index: index as any },
    );
    const ctx = {
      chatId: 1,
      requesterId: 1,
      proposal: null,
      canReadCode: true,
    };
    const found = await toolbox.run(
      'search_project',
      { query: 'checkout', source: 'jira' },
      ctx,
    );
    expect(found).toContain('by Faisal');
    expect(index.search).toHaveBeenCalledWith('checkout', 10, 'jira');
    await expect(
      toolbox.run('read_indexed', { source: 'jira', key: 'KAN-1' }, ctx),
    ).resolves.toContain('full text');
  });

  it('keeps PR contents for the owner', async () => {
    const index = {
      search: jest.fn().mockResolvedValue([
        {
          source: 'github',
          key: 'api#1',
          title: 'PR',
          url: null,
          meta: '',
          snippet: 'diff',
          updatedAt: null,
        },
        {
          source: 'jira',
          key: 'KAN-1',
          title: 'T',
          url: null,
          meta: '',
          snippet: 's',
          updatedAt: null,
        },
      ]),
      get: jest.fn(),
    };
    const toolbox = new PmToolbox(
      { repos: () => [], isConfigured: () => false } as any,
      { tiers: () => [], roles: () => [] } as any,
      {} as any,
      { index: index as any },
    );
    const guest = {
      chatId: 1,
      requesterId: 2,
      proposal: null,
      canReadCode: false,
    };
    const found = await toolbox.run('search_project', { query: 'x' }, guest);
    expect(found).toContain('KAN-1');
    expect(found).not.toContain('api#1');
    await expect(
      toolbox.run('search_project', { query: 'x', source: 'github' }, guest),
    ).rejects.toThrow('reserved for the owner');
    await expect(
      toolbox.run('read_indexed', { source: 'github', key: 'api#1' }, guest),
    ).rejects.toThrow('reserved for the owner');
    expect(index.get).not.toHaveBeenCalled();
  });
});
