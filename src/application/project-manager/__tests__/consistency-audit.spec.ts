import {
  AuditCheck,
  AuditItem,
  AuditKind,
  AuditRun,
  IAuditStore,
} from '@application/project-manager/audit.interface';
import { PM_UNAVAILABLE_REPLY } from '@application/project-manager/project-manager-ai.interface';
import {
  AUDIT_EVERY_MS,
  auditButtons,
  clipWords,
  MESSAGE_MAX,
  parseCheckData,
  parseComposed,
  renderAuditMessage,
  RunConsistencyAuditUseCase,
  stripMentions,
} from '@application/project-manager/use-cases/run-consistency-audit.use-case';

const now = new Date('2026-10-15T08:00:00Z');
const HOUR = 3_600_000;

const run = (over: Partial<AuditRun> = {}): AuditRun => ({
  runId: 'a1b2c3d4',
  status: 'running',
  phase: 'design-web',
  findings: {},
  items: [],
  posts: [],
  attempts: 0,
  error: null,
  startedBy: 'cron',
  startedAt: now,
  finishedAt: null,
  ...over,
});

const item = (kind: AuditKind, index: number, over: Partial<AuditItem> = {}) =>
  ({
    kind,
    index,
    title: `Пункт ${index + 1}`,
    detail: 'web: src/a.ts, mobile: app/b.tsx — разные лимиты',
    areas: ['web', 'mobile'],
    repeat: false,
    checkedBy: null,
    ...over,
  } as AuditItem);

// An in-memory store with the same rules as the Mongo one
const memoryStore = (initial: AuditRun[] = []) => {
  let runs = initial.map((r) => ({ ...r }));
  const find = (id: string) => runs.find((r) => r.runId === id);
  const store: jest.Mocked<IAuditStore> = {
    latest: jest.fn(async () =>
      runs.length
        ? [...runs].sort(
            (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
          )[0]
        : null,
    ),
    lastPosted: jest.fn(
      async () =>
        [...runs]
          .filter((r) => r.status === 'posted')
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ??
        null,
    ),
    get: jest.fn(async (id) => find(id) ?? null),
    create: jest.fn(async (r) => {
      if (runs.some((x) => x.status === 'running')) return null;
      runs.push({ ...r });
      return { ...r };
    }),
    update: jest.fn(async (id, patch) => {
      const r = find(id);
      if (!r || r.status !== 'running') return null;
      Object.assign(r, patch);
      return { ...r };
    }),
    toggle: jest.fn(async (id, kind, index, who: AuditCheck) => {
      const r = find(id);
      const it = r?.items.find((i) => i.kind === kind && i.index === index);
      if (!r || !it) return null;
      it.checkedBy = it.checkedBy ? null : who;
      return { ...r, items: r.items.map((i) => ({ ...i })) };
    }),
    claimStep: jest.fn<Promise<AuditRun | null>, [string, Date]>(async (id) => {
      const r = find(id);
      return r && r.status === 'running' ? { ...r } : null;
    }),
    releaseStep: jest.fn<Promise<void>, [string]>(async () => undefined),
  };
  return { store, all: () => runs, set: (r: AuditRun[]) => (runs = r) };
};

const setup = (
  opts: {
    runs?: AuditRun[];
    repos?: string[];
    auditRepos?: Record<string, string>;
    design?: boolean;
    chats?: number[];
    answers?: string[];
    digest?: string;
  } = {},
) => {
  const mem = memoryStore(opts.runs ?? []);
  const answerTexts = [...(opts.answers ?? [])];
  const answer = {
    execute: jest.fn(async () => ({
      text: answerTexts.length ? answerTexts.shift() : '- [web, mobile] x — y',
      proposal: null,
      choices: [],
    })),
  };
  const ai = {
    answer: jest.fn(),
    digest: jest.fn(
      async () =>
        opts.digest ??
        JSON.stringify({
          tech: [
            { title: 'Лимит', detail: 'd', areas: ['web'], repeat: false },
          ],
          design: [],
        }),
    ),
  };
  const knowledge = { all: jest.fn().mockResolvedValue([]) };
  const snapshots = {
    findLatest: jest.fn().mockResolvedValue({ render: () => 'SNAPSHOT' }),
  };
  let nextMessage = 100;
  const gateway = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sendWithButtons: jest.fn(async () => nextMessage++),
    setButtons: jest.fn().mockResolvedValue(undefined),
  };
  const repos = opts.repos ?? ['front', 'app', 'api'];
  const code = {
    isConfigured: () => repos.length > 0,
    repos: () => repos,
  };
  const design = {
    isConfigured: () => opts.design ?? true,
    fileKeys: () => ['KEY1'],
  };
  const config = {
    digestChatId: null,
    auditChatIds: opts.chats ?? [-1001],
    auditRepos: opts.auditRepos ?? {},
    projectBrief: 'brief',
    releaseDate: null,
  };
  const useCase = new RunConsistencyAuditUseCase(
    mem.store,
    answer as any,
    ai as any,
    knowledge as any,
    snapshots as any,
    gateway as any,
    config as any,
    code as any,
    design as any,
  );
  return { useCase, mem, answer, ai, gateway };
};

describe('RunConsistencyAuditUseCase.start / cron', () => {
  it('starts when nothing ran in the last 70 h and returns the running run', async () => {
    const { useCase, mem } = setup({
      runs: [
        run({
          status: 'posted',
          startedAt: new Date(now.getTime() - AUDIT_EVERY_MS - 1),
        }),
      ],
    });
    const started = await useCase.start(now, 'cron');
    expect(started?.status).toBe('running');
    expect(started?.runId).toMatch(/^[0-9a-f]{8}$/);
    expect(mem.all()).toHaveLength(2);
    // A second call hands back the same running run
    expect((await useCase.start(now, 'cron'))?.runId).toBe(started?.runId);
  });

  it('is not due within 70 h, unless forced', async () => {
    const recent = run({
      status: 'posted',
      startedAt: new Date(now.getTime() - 69 * HOUR),
    });
    const { useCase } = setup({ runs: [recent] });
    expect(await useCase.start(now, 'cron')).toBeNull();
    const forced = await useCase.start(now, 42, true);
    expect(forced?.startedBy).toBe(42);
  });

  it('cron reports nothing due', async () => {
    const { useCase } = setup({
      runs: [
        run({ status: 'posted', startedAt: new Date(now.getTime() - HOUR) }),
      ],
    });
    expect((await useCase.cron(now)).did).toBe('nothing due');
  });

  it('does not start without repos or chats', async () => {
    expect(await setup({ repos: [] }).useCase.start(now, 'cron')).toBeNull();
    expect(await setup({ chats: [] }).useCase.start(now, 1, true)).toBeNull();
  });
});

describe('RunConsistencyAuditUseCase.step', () => {
  it('runs one model phase per step through to posting', async () => {
    const { useCase, mem, answer, ai, gateway } = setup({
      runs: [run()],
      digest:
        '```json\n' +
        JSON.stringify({
          tech: [
            {
              title: 'Статусы',
              detail: 'web vs api',
              areas: ['web', 'backend'],
            },
          ],
          design: [{ title: 'Пустой экран', detail: 'нет', areas: ['design'] }],
        }) +
        '\n```',
    });
    const phases: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await useCase.step(now);
      phases.push(`${r?.phase}/${r?.status}`);
    }
    expect(phases).toEqual([
      'design-mobile/running',
      'web-mobile/running',
      'clients-backend/running',
      'compose/running',
      'post/posted',
    ]);
    expect(answer.execute).toHaveBeenCalledTimes(4);
    const [question, history, chat] = answer.execute.mock.calls[0] as any[];
    expect(question).toContain('explicitly asked to read the code');
    expect(question).toContain('front, app, api');
    expect(history).toEqual([]);
    expect(chat).toEqual({
      chatId: 0,
      requesterId: 0,
      canReadCode: true,
      noActions: true,
    });
    expect(ai.digest).toHaveBeenCalledTimes(1);
    expect((ai.digest.mock.calls[0] as any[])[0].question).toContain(
      '<findings pass="design-web">',
    );
    expect(gateway.sendWithButtons).toHaveBeenCalledTimes(2);
    const saved = mem.all()[0];
    expect(saved.posts).toEqual([
      { kind: 'tech', chatId: -1001, messageId: 100 },
      { kind: 'design', chatId: -1001, messageId: 101 },
    ]);
    expect(saved.finishedAt).toEqual(now);
    expect(saved.items.map((i) => [i.kind, i.index, i.checkedBy])).toEqual([
      ['tech', 0, null],
      ['design', 0, null],
    ]);
  });

  it('skips design phases without a design file and web-mobile without both roles', async () => {
    const { useCase, mem, answer } = setup({
      runs: [run()],
      design: false,
      auditRepos: { web: 'front', backend: 'api', mobile: 'not-allowed' },
    });
    const r = await useCase.step(now);
    // design-web, design-mobile and web-mobile skipped; clients-backend ran
    expect(r?.phase).toBe('compose');
    expect(answer.execute).toHaveBeenCalledTimes(1);
    expect((answer.execute.mock.calls[0] as any[])[0]).toContain(
      'web client = front; backend = api',
    );
    const f = mem.all()[0].findings;
    expect(f['design-web']).toMatch(/^SKIPPED: no design file/);
    expect(f['web-mobile']).toMatch(/^SKIPPED: needs both/);
  });

  it('fails when every comparison was skipped', async () => {
    const { useCase } = setup({ runs: [run()], design: false, repos: ['one'] });
    const r = await useCase.step(now);
    expect(r?.status).toBe('failed');
    expect(r?.error).toContain('nothing to compare');
  });

  it('posts "nothing found" without a model call when every pass found nothing', async () => {
    const { useCase, ai, gateway } = setup({
      runs: [run()],
      answers: ['NONE checked a', 'NONE', 'NONE', 'NONE'],
    });
    for (let i = 0; i < 5; i++) await useCase.step(now);
    expect(ai.digest).not.toHaveBeenCalled();
    expect(gateway.sendWithButtons).not.toHaveBeenCalled();
    expect(gateway.sendMessage).toHaveBeenCalledWith(
      -1001,
      expect.stringContaining('расхождений не найдено'),
    );
  });

  it('an unavailable answer counts as a failure; the second fails the run', async () => {
    const { useCase } = setup({
      runs: [run()],
      answers: [PM_UNAVAILABLE_REPLY, ''],
    });
    const first = await useCase.step(now);
    expect(first).toMatchObject({
      status: 'running',
      phase: 'design-web',
      attempts: 1,
    });
    const second = await useCase.step(now);
    expect(second?.status).toBe('failed');
    expect(second?.error).toContain('design-web');
  });

  it('a step killed twice fails the run on the next step', async () => {
    const { useCase, answer } = setup({ runs: [run({ attempts: 2 })] });
    expect((await useCase.step(now))?.status).toBe('failed');
    expect(answer.execute).not.toHaveBeenCalled();
  });

  it('returns the current run when another step holds it', async () => {
    const { useCase, mem, answer } = setup({ runs: [run()] });
    mem.store.claimStep.mockResolvedValueOnce(null);
    expect((await useCase.step(now))?.phase).toBe('design-web');
    expect(answer.execute).not.toHaveBeenCalled();
  });

  it('compose that returns garbage is retried, then fails', async () => {
    const { useCase } = setup({
      runs: [
        run({ phase: 'compose', findings: { 'web-mobile': '- [web] a — b' } }),
      ],
      digest: 'Извините, не могу',
    });
    expect((await useCase.step(now))?.attempts).toBe(1);
    expect((await useCase.step(now))?.status).toBe('failed');
  });

  it('a missed chat gets one more step, then the run is posted anyway', async () => {
    const { useCase, gateway, mem } = setup({
      runs: [run({ phase: 'post', items: [item('tech', 0)] })],
      chats: [-1, -2],
    });
    gateway.sendWithButtons
      .mockRejectedValueOnce(new Error('kicked'))
      .mockResolvedValueOnce(100)
      .mockRejectedValueOnce(new Error('kicked'));
    const first = await useCase.step(now);
    expect(first?.status).toBe('running');
    expect(mem.all()[0].posts).toEqual([
      { kind: 'tech', chatId: -2, messageId: 100 },
    ]);
    const r = await useCase.step(now);
    expect(r?.status).toBe('posted');
    // The chat that already got its list is not posted to again
    expect(gateway.sendWithButtons).toHaveBeenCalledTimes(3);
    expect(r?.error).toContain('kicked');
  });

  it('records the "nothing found" message so a retry does not repeat it', async () => {
    const { useCase, gateway, mem } = setup({
      runs: [run({ phase: 'post', items: [] })],
      chats: [-1, -2],
    });
    gateway.sendMessage.mockRejectedValueOnce(new Error('kicked'));
    await useCase.step(now);
    await useCase.step(now);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(3);
    expect(mem.all()[0].status).toBe('posted');
  });

  it('posts a list that only has deferred findings instead of "nothing found"', async () => {
    const { useCase, gateway } = setup({
      runs: [
        run({
          phase: 'post',
          items: [item('tech', 0)],
          deferred: [
            {
              kind: 'design',
              bucket: 'in_progress',
              title: 'Скелетон',
              ref: 'PR #417',
            },
          ],
        }),
      ],
      chats: [-1],
    });
    await useCase.step(now);
    expect(gateway.sendWithButtons).toHaveBeenCalledTimes(1);
    expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
    const text = gateway.sendMessage.mock.calls[0][1] as string;
    expect(text).toContain('Скелетон (PR #417)');
    expect(text).not.toContain('расхождений не найдено');
  });
});

describe('parseComposed', () => {
  it('rejects garbage', () => {
    expect(parseComposed('no json here')).toBeNull();
    expect(parseComposed('{ broken')).toBeNull();
    expect(parseComposed('{"other": 1}')).toBeNull();
  });

  it('reads a fenced object and clamps lengths and counts', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `T${i} ${'x'.repeat(80)}`,
      detail: 'y'.repeat(500),
      areas: ['web', 'WEB', 'nonsense'],
      repeat: i === 0,
    }));
    const out = parseComposed(
      `Вот:\n\`\`\`json\n${JSON.stringify({
        tech: many,
        design: [...many, { title: '' }, 'str'],
      })}\n\`\`\``,
    );
    expect(out?.tech).toHaveLength(20);
    expect(out?.design).toHaveLength(10);
    expect(Array.from(out?.tech[0].title ?? '').length).toBeLessThanOrEqual(40);
    expect(Array.from(out?.tech[0].detail ?? '').length).toBeLessThanOrEqual(
      300,
    );
    expect(out?.tech[0].areas).toEqual(['web']);
    expect(out?.tech[0].repeat).toBe(true);
    expect(out?.tech[1].repeat).toBe(false);
  });

  it('strips @mentions from titles and details', () => {
    const out = parseComposed(
      JSON.stringify({
        tech: [],
        design: [
          {
            title: 'Спросить @designer_x',
            detail: 'см. @ivan_p, mail a@b.com',
          },
        ],
      }),
    );
    expect(out?.design[0].title).toBe('Спросить designer_x');
    expect(out?.design[0].detail).toBe('см. ivan_p, mail a@b.com');
  });
});

describe('rendering and buttons', () => {
  const posted = run({
    status: 'posted',
    items: [
      ...Array.from({ length: 20 }, (_, i) =>
        item('tech', i, {
          title: `Очень длинный заголовок пункта номер ${i} ${'з'.repeat(30)}`,
          detail: `@lead ${'д'.repeat(400)}`,
          repeat: i % 2 === 0,
        }),
      ),
      item('design', 0, {
        checkedBy: { userId: 5, name: 'Оксана Длиннофамильная @oks', at: now },
      }),
    ],
  });

  it('keeps the message within 4000 chars, numbered, without mentions', () => {
    const text = renderAuditMessage(posted, 'tech', now);
    expect(text.length).toBeLessThanOrEqual(MESSAGE_MAX);
    expect(text).toContain('15.10.2026');
    expect(text).toContain('\n1. ');
    expect(text).toContain('\n20. ');
    expect(text).toContain('(повтор)');
    expect(text).not.toMatch(/(^|[^\w])@\w/);
  });

  it('buttons: one row per item, ≤ 60 chars, data ≤ 64 bytes that parses back', () => {
    const rows = [
      ...auditButtons(posted, 'tech'),
      ...auditButtons(posted, 'design'),
    ];
    expect(rows).toHaveLength(21);
    for (const [button] of rows) {
      expect(button.text.length).toBeLessThanOrEqual(60);
      expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
      expect(button.text).not.toContain('@');
    }
    expect(rows[0][0].text.startsWith('⬜ 1. ')).toBe(true);
    expect(rows[20][0].text).toMatch(/^✅ 1\. .* · Оксана/);
    expect(parseCheckData(rows[19][0].data)).toEqual({
      runId: 'a1b2c3d4',
      kind: 'tech',
      index: 19,
    });
    expect(parseCheckData(rows[20][0].data)).toEqual({
      runId: 'a1b2c3d4',
      kind: 'design',
      index: 0,
    });
  });

  it('parseCheckData is strict', () => {
    for (const bad of [
      'ck:A1B2C3D4:t1',
      'ck:a1b2c3d4:x1',
      'ck:a1b2c3d4:t123',
      'ck:a1b2c3d:t1',
      ' ck:a1b2c3d4:t1',
      'ck:a1b2c3d4:t1 ',
    ])
      expect(parseCheckData(bad)).toBeNull();
  });

  it('stripMentions keeps e-mails', () => {
    expect(stripMentions('@a_b1 и (@cdef) x@y.z')).toBe('a_b1 и (cdef) x@y.z');
  });
});

describe('RunConsistencyAuditUseCase.toggle', () => {
  const posted = () =>
    run({
      status: 'posted',
      items: [item('tech', 0), item('tech', 1)],
      posts: [
        { kind: 'tech', chatId: -1, messageId: 10 },
        { kind: 'tech', chatId: -2, messageId: 20 },
      ],
    });

  it('ticks and unticks, updating every message of that list', async () => {
    const { useCase, gateway } = setup({ runs: [posted()] });
    const who = { userId: 5, name: 'Иван @ivan' };
    const first = await useCase.toggle(
      'a1b2c3d4',
      'tech',
      1,
      { chatId: -1, messageId: 10 },
      who,
    );
    expect(first).toEqual({ ok: true, text: 'Отмечено' });
    expect(gateway.setButtons).toHaveBeenCalledTimes(2);
    const rows = gateway.setButtons.mock.calls[0][2];
    expect(rows[1][0].text).toBe('✅ 2. Пункт 2 · Иван ivan');
    const second = await useCase.toggle(
      'a1b2c3d4',
      'tech',
      1,
      { chatId: -2, messageId: 20 },
      who,
    );
    expect(second).toEqual({ ok: true, text: 'Снято' });
  });

  it('refuses a message that is not this run’s post of that kind', async () => {
    const { useCase, mem } = setup({ runs: [posted()] });
    for (const [kind, where] of [
      ['tech', { chatId: -1, messageId: 11 }],
      ['design', { chatId: -1, messageId: 10 }],
      ['tech', { chatId: -3, messageId: 10 }],
    ] as const) {
      const out = await useCase.toggle('a1b2c3d4', kind, 0, where, {
        userId: 1,
        name: 'x',
      });
      expect(out.ok).toBe(false);
    }
    expect(
      (
        await useCase.toggle(
          'ffffffff',
          'tech',
          0,
          { chatId: -1, messageId: 10 },
          { userId: 1, name: 'x' },
        )
      ).ok,
    ).toBe(false);
    expect(mem.store.toggle).not.toHaveBeenCalled();
  });

  it('a setButtons failure does not throw', async () => {
    const { useCase, gateway } = setup({ runs: [posted()] });
    gateway.setButtons.mockRejectedValue(new Error('message is not modified'));
    await expect(
      useCase.toggle(
        'a1b2c3d4',
        'tech',
        0,
        { chatId: -1, messageId: 10 },
        { userId: 1, name: 'x' },
      ),
    ).resolves.toEqual({ ok: true, text: 'Отмечено' });
  });
});

describe('audit quality: verdict, release, deferred, whole words', () => {
  it('cuts a long detail at a word or sentence, never mid-word', () => {
    const text =
      'Поле в состоянии Error с плашкой. Web отключает поля и показывает PriceLockNotice, а в API нет поля с источником блокировки для оффера';
    const cut = clipWords(text, 90);
    expect(Array.from(cut).length).toBeLessThanOrEqual(90);
    expect(text.startsWith(cut.replace(/…$/, ''))).toBe(true);
    // Ends on a sentence or on a whole word plus an ellipsis
    expect(/[.…]$/.test(cut)).toBe(true);
    const lastWord = cut.replace(/…$/, '').split(' ').pop() ?? '';
    expect(text.split(/\s+/).map((w) => w.replace(/[.,]$/, ''))).toContain(
      lastWord.replace(/[.,]$/, ''),
    );
    expect(clipWords('коротко', 90)).toBe('коротко');
  });

  it('reads the verdict, the release flag and the deferred findings', () => {
    const parsed = parseComposed(
      JSON.stringify({
        tech: [
          { title: 'Не к релизу', detail: 'd', fix: 'web', release: false },
          { title: 'К релизу', detail: 'd', fix: 'nonsense', release: true },
        ],
        design: [],
        deferred: [
          {
            kind: 'design',
            bucket: 'in_progress',
            title: 'Скелетон',
            ref: 'PR #417',
          },
          { kind: 'tech', bucket: 'later', title: 'События', ref: 'MVP 3' },
          { kind: 'tech', bucket: 'odd', title: '' },
        ],
      }),
    );
    // Release items move to the top
    expect(parsed?.tech.map((d) => d.title)).toEqual([
      'К релизу',
      'Не к релизу',
    ]);
    expect(parsed?.tech[0].fix).toBeNull();
    expect(parsed?.tech[1].fix).toBe('web');
    expect(parsed?.deferred).toEqual([
      { kind: 'tech', bucket: 'later', title: 'События', ref: 'MVP 3' },
      {
        kind: 'design',
        bucket: 'in_progress',
        title: 'Скелетон',
        ref: 'PR #417',
      },
    ]);
  });

  it('shows the release mark, the verdict and what was left off the list', () => {
    const r = run({
      status: 'posted',
      items: [
        item('design', 0, { title: 'Тексты', fix: 'mobile', release: true }),
        item('design', 1, { title: 'Вкладки', fix: 'design' }),
      ],
      deferred: [
        {
          kind: 'design',
          bucket: 'in_progress',
          title: 'Скелетон',
          ref: 'PR #417',
        },
        { kind: 'design', bucket: 'later', title: 'Офферы', ref: 'MVP 3' },
        { kind: 'tech', bucket: 'later', title: 'Чужое', ref: '' },
      ],
    });
    const text = renderAuditMessage(r, 'design', now);
    expect(text).toContain('1. 🔴 Тексты');
    expect(text).toContain('→ мобилку');
    expect(text).toContain('2. Вкладки');
    expect(text).toContain('→ дизайн');
    expect(text).toContain('Уже в работе, не в списке: Скелетон (PR #417).');
    expect(text).toContain('Позже, не в текущем релизе: Офферы (MVP 3).');
    expect(text).not.toContain('Чужое');
  });

  it('drops the deferred block before cutting the list itself', () => {
    const long = 'слово '.repeat(60).trim();
    const r = run({
      items: Array.from({ length: 20 }, (_, i) =>
        item('tech', i, { title: `Пункт ${i}`, detail: long }),
      ),
      deferred: Array.from({ length: 8 }, (_, i) => ({
        kind: 'tech' as const,
        bucket: 'later' as const,
        title: `Позже ${i}`,
        ref: 'MVP 3',
      })),
    });
    const text = renderAuditMessage(r, 'tech', now);
    expect(text.length).toBeLessThanOrEqual(MESSAGE_MAX);
    expect(text).toContain('20. Пункт 19');
  });
});

describe('clipWords with long tokens', () => {
  it('keeps most of the text when a long path follows the last space', () => {
    const cut = clipWords(
      'Web: src/features/offers/components/PriceLockNotice/PriceLockNotice.tsx показывает плашку',
      50,
    );
    expect(Array.from(cut).length).toBeLessThanOrEqual(50);
    expect(Array.from(cut).length).toBeGreaterThan(40);
  });
});
