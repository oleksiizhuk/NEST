import {
  codeSignals,
  IssueFact,
  issueSignals,
  PullFact,
  RunFact,
} from '@application/project-manager/metrics';
import {
  memoryExpiry,
  renderMemory,
} from '@application/project-manager/memory.interface';
import { readinessChecklist } from '@application/project-manager/readiness';
import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import {
  formatAlerts,
  WatchProjectUseCase,
} from '@application/project-manager/use-cases/watch-project.use-case';
import {
  checkAnswer,
  RunGoldenEvalUseCase,
} from '@application/project-manager/use-cases/run-golden-eval.use-case';
import { parseGolden } from '@infrastructure/http/project-manager/golden.parser';

const NOW = new Date('2026-09-23T10:00:00Z'); // Wednesday

const fact = (key: string, over: Partial<IssueFact>): IssueFact => ({
  key,
  summary: `Summary ${key}`,
  type: 'Story',
  status: 'To Do',
  category: 'new',
  priority: 'Medium',
  assignee: 'Ann',
  fixVersions: ['1.0'],
  created: null,
  doneAt: null,
  statusSince: null,
  due: null,
  ...over,
});

describe('issueSignals', () => {
  it('raises blockers and unassigned high-priority release work', () => {
    const signals = issueSignals(
      [
        fact('A-1', { priority: 'Blocker' }),
        fact('A-2', { blockedBy: ['B-9'] }),
        fact('A-3', { priority: 'High', assignee: null }),
        fact('A-4', { priority: 'High', assignee: null, fixVersions: ['2.0'] }),
        fact('A-5', { type: 'Epic', priority: 'Blocker' }),
        fact('A-6', {}),
      ],
      '1.0',
    );
    expect(signals.map((s) => `${s.rule}:${s.subject}`)).toEqual([
      'blocker:A-1',
      'blocker:A-2',
      'release-unassigned:A-3',
    ]);
    expect(signals[1].text).toContain('заблокирована B-9');
  });
});

describe('codeSignals', () => {
  const pr = (over: Partial<PullFact>): PullFact => ({
    repo: 'api',
    number: 1,
    author: 'dev',
    draft: false,
    createdAt: '2026-09-17T00:00:00Z',
    updatedAt: '2026-09-17T00:00:00Z',
    reviews: 0,
    ...over,
  });
  const run = (over: Partial<RunFact>): RunFact => ({
    repo: 'api',
    workflow: 'Deploy',
    branch: 'main',
    conclusion: 'failure',
    createdAt: '2026-09-23T06:00:00Z',
    ...over,
  });

  it('flags review waits and release branches red for over two hours', () => {
    const signals = codeSignals(
      [pr({}), pr({ number: 2, reviews: 1 }), pr({ number: 3, draft: true })],
      [
        run({}),
        run({ branch: 'feature/x' }),
        run({ workflow: 'CI', createdAt: '2026-09-23T09:30:00Z' }),
      ],
      NOW,
    );
    expect(signals.map((s) => `${s.rule}:${s.subject}`)).toEqual([
      'review-wait:api#1',
      'red-pipeline:api:Deploy@main:2026-09-23T06:00:00Z',
    ]);
  });
});

describe('memory helpers', () => {
  it('keeps each kind for its own time', () => {
    const due = new Date('2026-09-25T23:59:59Z');
    expect(memoryExpiry('decision', NOW, null)?.toISOString()).toBe(
      '2026-12-22T10:00:00.000Z',
    );
    expect(memoryExpiry('commitment', NOW, due)?.toISOString()).toBe(
      '2026-10-02T23:59:59.000Z',
    );
    expect(memoryExpiry('person', NOW, null)).toBeNull();
  });

  it('renders records oldest first and drops the oldest over budget', () => {
    const rec = (id: string, text: string) => ({
      id,
      kind: 'fact' as const,
      text,
      dueAt: null,
      createdAt: NOW,
      expiresAt: null,
      author: 'Ann',
    });
    expect(renderMemory([rec('M1', 'a'), rec('M2', 'b')])).toBe(
      '<memory>\n- [M1] fact, 2026-09-23, from Ann: a\n- [M2] fact, 2026-09-23, from Ann: b\n</memory>',
    );
    const big = renderMemory([
      rec('M1', 'x'.repeat(5000)),
      rec('M2', 'y'.repeat(5000)),
    ]);
    expect(big).toContain('[M2]');
    expect(big).not.toContain('[M1]');
    expect(renderMemory([])).toBe('');
  });
});

const snapshotWith = (
  issues?: Record<string, number>,
  code?: Record<string, number>,
  extra: Partial<{ signals: any[]; ok: boolean }> = {},
) =>
  new ProjectSnapshot('s', NOW, [
    {
      source: 'issues',
      ok: extra.ok ?? true,
      fetchedAt: NOW,
      text: '',
      error: null,
      ...(issues ? { metrics: issues } : {}),
      ...(extra.signals ? { signals: extra.signals } : {}),
    },
    {
      source: 'code',
      ok: true,
      fetchedAt: NOW,
      text: '',
      error: null,
      ...(code ? { metrics: code } : {}),
    },
  ]);

describe('readinessChecklist', () => {
  it('marks each gate yes, no or no data', () => {
    const text = readinessChecklist(
      snapshotWith(
        { blockers: 0, openHighBugs: 2, unassignedHigh: 0, scope: 9 },
        { redPipelines: 0, waitingReview: 1 },
      ),
      'QA sign-off in the ticket',
    );
    expect(text).toContain('НЕ ГОТОВ: 2 пункт(а) не выполнено');
    expect(text).toContain('✅ Блокеры в объёме релиза: 0');
    expect(text).toContain('❌ Открытые баги высокого приоритета: 2');
    expect(text).toContain(
      '❔ Недоставленные коммиты между ветками (макс.): нет данных',
    );
    expect(text).toContain('QA sign-off in the ticket');
  });
});

describe('WatchProjectUseCase', () => {
  const build = (over: Partial<Record<string, any>> = {}) => {
    const deps = {
      refresh: {
        execute: jest.fn().mockResolvedValue(
          snapshotWith(
            { blockers: 1 },
            {},
            {
              signals: [
                { rule: 'blocker', subject: 'A-1', text: 'A-1 blocker' },
              ],
            },
          ),
        ),
      },
      snapshots: { findLatest: jest.fn() },
      telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
      config: {
        alertChatIds: [1],
        releaseDate: '2026-09-30',
        team: ['Ann'],
      },
      alerts: { claim: jest.fn().mockResolvedValue(true) },
      knowledge: { all: jest.fn().mockResolvedValue([]) },
      memory: {
        active: jest.fn().mockResolvedValue([
          {
            id: 'M1',
            kind: 'commitment',
            text: 'Ivan merges PR 12',
            dueAt: new Date('2026-09-22T23:59:59Z'),
            author: 'Ann',
          },
        ]),
      },
      issues: {
        isConfigured: () => true,
        recentComments: jest.fn().mockResolvedValue([
          {
            source: 'jira',
            where: 'ABC-1',
            link: 'https://x/ABC-1',
            author: 'Client Faisal',
            createdAt: new Date('2026-09-17T10:00:00Z'),
            text: 'When will checkout be ready?',
            replies: [],
            resolved: false,
          },
          {
            source: 'jira',
            where: 'ABC-2',
            link: null,
            author: 'Ann',
            createdAt: new Date('2026-09-17T10:00:00Z'),
            text: 'Who owns this?',
            replies: [],
            resolved: false,
          },
        ]),
      },
      ...over,
    };
    const useCase = new WatchProjectUseCase(
      deps.refresh as any,
      deps.snapshots as any,
      deps.telegram as any,
      deps.config as any,
      deps.alerts,
      deps.knowledge as any,
      deps.memory as any,
      deps.issues as any,
    );
    return { useCase, deps };
  };

  it('sends new events once, grouped, to the alert chats', async () => {
    const { useCase, deps } = build();
    const { signals, sent } = await useCase.execute(NOW);
    expect(signals.map((s) => s.rule)).toEqual([
      'readiness',
      'blocker',
      'client-question',
      'commitment-overdue',
    ]);
    expect(deps.alerts.claim).toHaveBeenCalledWith(1, 'blocker:A-1', NOW);
    expect(deps.alerts.claim).toHaveBeenCalledWith(
      1,
      'readiness:2026-09-30:T-5',
      NOW,
    );
    expect(sent).toEqual({ 1: 4 });
    const text = deps.telegram.sendMessage.mock.calls[0][1];
    expect(text).toContain('Блокеры:\n- A-1 blocker');
    expect(text).toContain('Client Faisal · ABC-1 · 4 раб. дн.');
    expect(text).not.toContain('Who owns this');
    expect(text).toContain('Ivan merges PR 12');
  });

  it('stays silent when everything was already sent', async () => {
    const { useCase, deps } = build();
    deps.alerts.claim.mockResolvedValue(false);
    await useCase.execute(NOW);
    expect(deps.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores stale sections and sends nothing on a dry run', async () => {
    const { useCase, deps } = build();
    deps.snapshots.findLatest.mockResolvedValue(
      snapshotWith(
        {},
        {},
        {
          ok: false,
          signals: [{ rule: 'blocker', subject: 'A-1', text: 'old' }],
        },
      ),
    );
    const { signals } = await useCase.execute(NOW, true);
    expect(deps.refresh.execute).not.toHaveBeenCalled();
    expect(signals.some((s) => s.rule === 'blocker')).toBe(false);
    expect(deps.alerts.claim).not.toHaveBeenCalled();
    expect(deps.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('caps each group', () => {
    const text = formatAlerts(
      Array.from({ length: 10 }, (_, i) => ({
        rule: 'review-wait',
        subject: String(i),
        text: `PR ${i}`,
      })),
    );
    expect(text).toContain('- PR 7');
    expect(text).not.toContain('- PR 8');
    expect(text).toContain('…и ещё 2');
  });
});

describe('golden eval', () => {
  it('checks required and forbidden text and time', () => {
    expect(
      checkAnswer(
        {
          mustContain: ['ON TRACK', '/ABC-\\d+/'],
          mustNotContain: ['I cannot'],
          maxSeconds: 60,
        },
        'Verdict: on track, see ABC-12. I cannot say more',
        75,
      ),
    ).toEqual(['should not contain: I cannot', 'slow: 75s > 60s']);
  });

  it('runs due cases within the budget and reports once when all are done', async () => {
    const saved: Record<string, any> = {};
    const cases = [
      {
        id: 'a',
        question: 'status?',
        mustContain: ['ok'],
        mustNotContain: [],
        maxSeconds: 60,
        last: null,
      },
      {
        id: 'b',
        question: 'owner?',
        mustContain: ['Ann'],
        mustNotContain: [],
        maxSeconds: 60,
        last: { at: NOW, pass: true, seconds: 5, failures: [], answer: '' },
      },
    ];
    const golden = {
      all: jest.fn(async () =>
        cases.map((c) => ({ ...c, last: saved[c.id] ?? c.last })),
      ),
      replaceAll: jest.fn(),
      saveResult: jest.fn(async (id: string, r: any) => {
        saved[id] = r;
      }),
    };
    const answer = { execute: jest.fn().mockResolvedValue({ text: 'all ok' }) };
    const telegram = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const alerts = { claim: jest.fn().mockResolvedValue(true) };
    const useCase = new RunGoldenEvalUseCase(
      golden,
      answer as any,
      telegram as any,
      { alertChatIds: [1] } as any,
      alerts,
    );
    const result = await useCase.execute(NOW);
    expect(result).toEqual({ ran: ['a'], remaining: 0, reported: true });
    expect(answer.execute.mock.calls[0][0]).toBe('eval: status?');
    expect(answer.execute.mock.calls[0][2]).toEqual({
      chatId: 0,
      requesterId: 0,
    });
    expect(telegram.sendMessage.mock.calls[0][1]).toContain('2/2 пройдено');
    expect(alerts.claim).toHaveBeenCalledWith(1, 'eval:2026-W39', NOW);
  });

  it('stops before a case that would not fit in the budget', async () => {
    const golden = {
      all: jest.fn().mockResolvedValue([
        {
          id: 'a',
          question: 'q',
          mustContain: [],
          mustNotContain: [],
          maxSeconds: 120,
          last: null,
        },
      ]),
      replaceAll: jest.fn(),
      saveResult: jest.fn(),
    };
    const answer = { execute: jest.fn() };
    const useCase = new RunGoldenEvalUseCase(
      golden,
      answer as any,
      { sendMessage: jest.fn() } as any,
      { alertChatIds: [1] } as any,
      { claim: jest.fn() },
    );
    expect(await useCase.execute(NOW, 60_000)).toEqual({
      ran: [],
      remaining: 1,
      reported: false,
    });
    expect(answer.execute).not.toHaveBeenCalled();
  });

  it('validates uploaded cases', () => {
    expect(
      parseGolden([{ id: 'status', question: 'How are we doing?' }]),
    ).toEqual([
      {
        id: 'status',
        question: 'How are we doing?',
        mustContain: [],
        mustNotContain: [],
        maxSeconds: 120,
      },
    ]);
    expect(() => parseGolden([{ id: 'bad id!', question: 'q' }])).toThrow(
      'bad id',
    );
    expect(() =>
      parseGolden([
        { id: 'a', question: 'q' },
        { id: 'a', question: 'q' },
      ]),
    ).toThrow('duplicate');
    expect(() =>
      parseGolden([{ id: 'a', question: 'q', maxSeconds: 999 }]),
    ).toThrow('maxSeconds');
  });
});
