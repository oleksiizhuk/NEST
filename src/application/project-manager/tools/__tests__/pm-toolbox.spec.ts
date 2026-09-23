import { Remark } from '@application/project-manager/collaboration.interface';
import {
  PmToolbox,
  pickOne,
  ToolContext,
} from '@application/project-manager/tools/pm-toolbox';
import {
  assertReadablePath,
  redactSecrets,
} from '@application/project-manager/tools/untrusted';

const code = {
  isConfigured: () => true,
  repos: () => ['mobile', 'api'],
  searchCode: jest
    .fn()
    .mockResolvedValue([{ path: 'src/a.ts', fragments: ['const x = 1'] }]),
  readFile: jest
    .fn()
    .mockResolvedValue(
      'src/a.ts lines 1-1 of 1\n1: token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789"',
    ),
  listDir: jest.fn().mockResolvedValue(['src/', 'README.md']),
  pullRequest: jest.fn().mockResolvedValue('#1 Fix'),
};
const staging = {
  isConfigured: jest.fn(() => true),
  describeTarget: () => 'api.staging.example',
  whoAmI: jest.fn(),
  findMalls: jest.fn(),
  findCategories: jest.fn(),
  findBrands: jest.fn(),
  createBrand: jest.fn(),
  getBrand: jest.fn(),
  publishStores: jest.fn(),
  unpublishStores: jest.fn(),
  deleteBrand: jest.fn(),
  updateStore: jest.fn(),
  createProperty: jest.fn(),
  publishProperties: jest.fn(),
  unpublishProperties: jest.fn(),
};
const targets = {
  tiers: () => (staging.isConfigured() ? ['dev', 'staging'] : []),
  roles: () => ['client', 'admin'],
  target: jest.fn((): typeof staging => staging),
};
const actions = {
  create: jest.fn(async (a) => ({
    ...a,
    id: 'K7Q2A',
    status: 'pending',
    result: null,
  })),
  claim: jest.fn(),
  latestPending: jest.fn(),
  recent: jest.fn(),
  finish: jest.fn(),
  cancel: jest.fn(),
};
const ctx = (): ToolContext => ({
  chatId: -100,
  requesterId: 7,
  proposal: null,
});
const brandInput = {
  name_en: 'Test Brand',
  name_ar: 'تست',
  mall: 'Galleria',
  category: 'Fashion',
};

describe('PmToolbox', () => {
  const toolbox = new PmToolbox(code, targets, actions as any);
  beforeEach(() => {
    jest.clearAllMocks();
    staging.isConfigured.mockReturnValue(true);
    staging.findMalls.mockResolvedValue([
      { id: 'm1', name: 'Galleria' },
      { id: 'm2', name: 'Galleria Plaza' },
    ]);
    staging.findCategories.mockResolvedValue([{ id: 'c1', name: 'Fashion' }]);
    staging.findBrands.mockResolvedValue([]);
  });

  it('offers the same tools in the same order every time, repo limited to the allowlist', () => {
    const specs = toolbox.specs();
    expect(specs.map((s) => s.name)).toEqual([
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
    expect(
      (specs[0].input_schema.properties.repo as { enum: string[] }).enum,
    ).toEqual(['mobile', 'api']);
    expect(JSON.stringify(toolbox.specs())).toBe(JSON.stringify(specs));
  });

  it('wraps file contents as untrusted data and masks committed secrets', async () => {
    const out = await toolbox.run(
      'read_file',
      { repo: 'api', path: 'src/a.ts' },
      ctx(),
    );
    expect(out).toMatch(/^<tool_data source="github:api\/src\/a.ts">/);
    expect(out).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).toContain('[redacted]');
  });

  it('refuses to read env files, keys and parent paths', async () => {
    await expect(
      toolbox.run('read_file', { repo: 'api', path: '.env.staging' }, ctx()),
    ).rejects.toThrow(/secrets/);
    await expect(
      toolbox.run('read_file', { repo: 'api', path: 'certs/prod.pem' }, ctx()),
    ).rejects.toThrow(/secrets/);
    await expect(
      toolbox.run('list_dir', { repo: 'api', path: '../other' }, ctx()),
    ).rejects.toThrow(/\.\./);
    expect(code.readFile).not.toHaveBeenCalled();
  });

  it('stores a proposal — never executes — when names resolve to exactly one item', async () => {
    const c = ctx();
    const out = await toolbox.run('propose_create_brand', brandInput, c);
    expect(out).toMatch(/Proposal K7Q2A stored, NOT executed/);
    expect(staging.createBrand).not.toHaveBeenCalled();
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'create_brand',
        chatId: -100,
        requesterId: 7,
        payload: expect.objectContaining({
          tier: 'dev',
          nameEn: 'Test Brand',
          mallId: 'm1',
          categoryId: 'c1',
          open: '10:00',
          close: '22:00',
        }),
      }),
    );
    expect(c.proposal?.id).toBe('K7Q2A');
  });

  it('keeps offered choices as short distinct labels for the reply buttons', async () => {
    const c = ctx();
    const out = await toolbox.run(
      'offer_choices',
      {
        options: ['  Galleria,  Riyadh ', 'Galleria, Riyadh', 'Park Avenue', 7],
      },
      c,
    );
    expect(c.choices).toEqual(['Galleria, Riyadh', 'Park Avenue']);
    expect(out).toContain('2 buttons');
    await expect(
      toolbox.run('offer_choices', { options: ['only one'] }, ctx()),
    ).rejects.toThrow('2 to 6');
  });

  it('refuses choices in a message that already holds a proposal', async () => {
    const c = { ...ctx(), reserved: true };
    await expect(
      toolbox.run('offer_choices', { options: ['A', 'B'] }, c),
    ).rejects.toThrow('Confirm/Cancel');
    expect(c.choices).toBeUndefined();
  });

  it('proposes a memory record with its author; a commitment needs a due date', async () => {
    const withMemory = new PmToolbox(code, targets, actions as any, {
      memory: true,
    });
    expect(withMemory.specs().map((t) => t.name)).toContain('propose_remember');
    expect(
      await withMemory.run(
        'propose_remember',
        { kind: 'commitment', text: 'Ivan merges PR 12' },
        ctx(),
      ),
    ).toContain('NOT PROPOSED');
    const c = { ...ctx(), requesterName: 'Ann @ann' };
    await withMemory.run(
      'propose_remember',
      { kind: 'decision', text: 'Filters  are out of the release' },
      c,
    );
    expect(actions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'remember',
        payload: {
          kind: 'decision',
          text: 'Filters are out of the release',
          dueAt: null,
          author: 'Ann @ann',
        },
        summary: 'Запомнить (decision): «Filters are out of the release»',
      }),
    );
    expect(c.proposal?.id).toBe('K7Q2A');
    await expect(
      withMemory.run(
        'propose_remember',
        { kind: 'commitment', text: 'x merges', due: '2026-13-05' },
        ctx(),
      ),
    ).rejects.toThrow('real date');
    expect(
      await withMemory.run(
        'propose_remember',
        { kind: 'commitment', text: 'x merges', due: '2020-01-01' },
        ctx(),
      ),
    ).toContain('already past');
  });

  it('allows one proposal per message', async () => {
    const c = ctx();
    await toolbox.run('propose_create_brand', brandInput, c);
    await expect(
      toolbox.run('propose_create_brand', brandInput, c),
    ).rejects.toThrow(/one proposal/);
  });

  it('returns candidates instead of guessing an ambiguous mall', async () => {
    const out = await toolbox.run(
      'propose_create_brand',
      { ...brandInput, mall: 'Cent' },
      ctx(),
    );
    expect(out).toMatch(/NOT PROPOSED/);
    expect(out).toContain('Galleria (id m1)');
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('refuses to propose a brand that already exists', async () => {
    staging.findBrands.mockResolvedValue([{ id: 'b9', name: 'test brand' }]);
    const out = await toolbox.run('propose_create_brand', brandInput, ctx());
    expect(out).toMatch(/already exists on dev \(id b9\)/);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('reports staging as unavailable when it is not configured', async () => {
    staging.isConfigured.mockReturnValue(false);
    await expect(
      toolbox.run('staging_lookup', { entity: 'mall', query: 'x' }, ctx()),
    ).rejects.toThrow(/No test environment/);
  });
});

describe('PmToolbox environments', () => {
  const toolbox = new PmToolbox(code, targets, actions as any);
  beforeEach(() => staging.isConfigured.mockReturnValue(true));

  it('offers only configured environments and rejects others, including production', async () => {
    const tier = toolbox.specs()[4].input_schema.properties.tier as {
      enum: string[];
    };
    expect(tier.enum).toEqual(['dev', 'staging']);
    await expect(
      toolbox.run(
        'staging_lookup',
        { tier: 'production', entity: 'mall', query: 'x' },
        ctx(),
      ),
    ).rejects.toThrow(/Unknown environment "production"/);
  });
});

describe('PmToolbox brand actions', () => {
  const toolbox = new PmToolbox(code, targets, actions as any);
  beforeEach(() => {
    jest.clearAllMocks();
    staging.isConfigured.mockReturnValue(true);
    staging.findMalls.mockResolvedValue([{ id: 'm1', name: 'Galleria' }]);
    staging.findCategories.mockResolvedValue([{ id: 'c1', name: 'Fashion' }]);
    staging.findBrands.mockResolvedValue([{ id: 'b1', name: 'Test Brand' }]);
    staging.getBrand.mockResolvedValue({
      id: 'b1',
      name: 'Test Brand',
      stores: [
        { id: 's1', name: 'Test Brand', status: 'draft', property: 'Galleria' },
      ],
    });
  });

  it('leaves floor, wing and gate empty unless given', async () => {
    staging.findBrands.mockResolvedValue([]);
    await toolbox.run(
      'propose_create_brand',
      { name_en: 'New', name_ar: 'ن', mall: 'Galleria', category: 'Fashion' },
      ctx(),
    );
    const call = actions.create.mock.calls[0][0];
    expect(call.payload).toMatchObject({
      floor: '',
      wing: '',
      nearestGate: '',
    });
    expect(call.summary).toContain('этаж, крыло и вход не указаны');
  });

  it('shows a brand with its stores and their status', async () => {
    const out = await toolbox.run(
      'staging_get_brand',
      { brand: 'Test Brand' },
      ctx(),
    );
    expect(out).toContain('Test Brand (id b1)');
    expect(out).toContain('- store s1: draft in Galleria');
  });

  it('stores a publish proposal for the resolved brand, executing nothing', async () => {
    const c = ctx();
    const out = await toolbox.run(
      'propose_brand_action',
      { brand: 'Test Brand', action: 'publish' },
      c,
    );
    expect(out).toMatch(/NOT executed/);
    expect(actions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'publish_brand',
        payload: {
          tier: 'dev',
          role: 'client',
          brandId: 'b1',
          brandName: 'Test Brand',
        },
        summary: expect.stringContaining(
          'Опубликовать все магазины (1) бренда "Test Brand"',
        ),
      }),
    );
    expect(staging.publishStores).not.toHaveBeenCalled();
  });

  it('accepts a brand id directly and marks delete as irreversible', async () => {
    await toolbox.run(
      'propose_brand_action',
      { brand: '01a0ce3c-3716-7349-aad0-c6efd1707153', action: 'delete' },
      ctx(),
    );
    expect(staging.findBrands).not.toHaveBeenCalled();
    expect(actions.create.mock.calls[0][0].summary).toMatch(
      /Удалить \(без возможности восстановления/,
    );
  });

  it('asks instead of guessing when the brand name is ambiguous', async () => {
    staging.findBrands.mockResolvedValue([
      { id: 'b1', name: 'Test A' },
      { id: 'b2', name: 'Test B' },
    ]);
    const out = await toolbox.run(
      'propose_brand_action',
      { brand: 'Test', action: 'publish' },
      ctx(),
    );
    expect(out).toMatch(/NOT PROPOSED/);
    expect(actions.create).not.toHaveBeenCalled();
  });
});

describe('PmToolbox stores and properties', () => {
  const toolbox = new PmToolbox(code, targets, actions as any);
  beforeEach(() => {
    jest.clearAllMocks();
    staging.isConfigured.mockReturnValue(true);
    staging.findBrands.mockResolvedValue([{ id: 'b1', name: 'Test Brand' }]);
    staging.findCategories.mockResolvedValue([{ id: 'c2', name: 'Food' }]);
    staging.findMalls.mockResolvedValue([
      { id: 'm1', name: 'Galleria', type: 'mall', city: 'Riyadh' },
    ]);
    staging.getBrand.mockResolvedValue({
      id: 'b1',
      name: 'Test Brand',
      stores: [
        { id: 's1', name: 'Test Brand', status: 'draft', property: 'Galleria' },
        {
          id: 's2',
          name: 'Test Brand',
          status: 'active',
          property: 'Panorama',
        },
      ],
    });
  });

  it('proposes a store edit with only the given fields, choosing the store by mall', async () => {
    const out = await toolbox.run(
      'propose_update_store',
      {
        brand: 'Test Brand',
        store: 'panorama',
        floor: null,
        open: '09:00',
        category: 'Food',
      },
      ctx(),
    );
    expect(out).toMatch(/NOT executed/);
    const call = actions.create.mock.calls[0][0];
    expect(call.kind).toBe('update_store');
    expect(call.payload).toMatchObject({
      brandId: 'b1',
      storeId: 's2',
      changes: { floor: null, open: '09:00', categoryId: 'c2' },
    });
    expect(call.payload.changes).not.toHaveProperty('wing');
    expect(call.summary).toContain('Остальные магазины бренда не меняются');
    expect(staging.updateStore).not.toHaveBeenCalled();
  });

  it('asks which store when the brand has several and none is named', async () => {
    const out = await toolbox.run(
      'propose_update_store',
      { brand: 'Test Brand', floor: 'L2' },
      ctx(),
    );
    expect(out).toMatch(/pick one store/);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('rejects bad hours and empty edits', async () => {
    await expect(
      toolbox.run(
        'propose_update_store',
        { brand: 'Test Brand', store: 's1', open: '9am' },
        ctx(),
      ),
    ).rejects.toThrow(/HH:MM/);
    await expect(
      toolbox.run(
        'propose_update_store',
        { brand: 'Test Brand', store: 's1' },
        ctx(),
      ),
    ).rejects.toThrow(/nothing to change/);
  });

  it('proposes a new mall as a draft and refuses an existing name', async () => {
    staging.findMalls.mockResolvedValueOnce([]);
    await toolbox.run(
      'propose_create_property',
      {
        type: 'mall',
        name_en: 'QA Mall',
        name_ar: 'مول',
        city: 'Riyadh',
        latitude: 24.7,
        longitude: 46.6,
      },
      ctx(),
    );
    const call = actions.create.mock.calls[0][0];
    expect(call).toMatchObject({
      kind: 'create_property',
      payload: {
        type: 'mall',
        nameEn: 'QA Mall',
        city: 'Riyadh',
        latitude: 24.7,
      },
    });
    expect(call.summary).toContain('Будет черновиком');

    const out = await toolbox.run(
      'propose_create_property',
      { type: 'mall', name_en: 'Galleria', name_ar: 'غ', city: 'Riyadh' },
      ctx(),
    );
    expect(out).toMatch(/already exists/);
  });

  it('proposes publishing a property resolved by name', async () => {
    await toolbox.run(
      'propose_property_action',
      { property: 'Galleria', action: 'publish' },
      ctx(),
    );
    expect(actions.create.mock.calls[0][0]).toMatchObject({
      kind: 'publish_property',
      payload: { propertyId: 'm1', propertyName: 'Galleria' },
    });
  });
});

describe('PmToolbox review fixes', () => {
  const toolbox = new PmToolbox(code, targets, actions as any);
  beforeEach(() => {
    jest.clearAllMocks();
    staging.isConfigured.mockReturnValue(true);
    staging.findMalls.mockResolvedValue([
      { id: 'm1', name: 'Riyadh Park', type: 'mall', city: 'Riyadh' },
      { id: 'm2', name: 'Riyadh Park Extension', type: 'mall', city: 'Riyadh' },
    ]);
    staging.findCategories.mockResolvedValue([{ id: 'c1', name: 'Fashion' }]);
    staging.findBrands.mockResolvedValue([]);
  });

  it('lets only one of two parallel proposals through', async () => {
    const c = ctx();
    const input = {
      name_en: 'A',
      name_ar: 'ا',
      mall: 'Riyadh Park',
      category: 'Fashion',
    };
    const results = await Promise.allSettled([
      toolbox.run('propose_create_brand', input, c),
      toolbox.run('propose_create_brand', { ...input, name_en: 'B' }, c),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(actions.create).toHaveBeenCalledTimes(1);
  });

  it('discards a proposal that lands after the turn was closed', async () => {
    const c = ctx();
    actions.create.mockImplementationOnce(async (a: any) => {
      c.closed = true; // the loop timed the tool out meanwhile
      return { ...a, id: 'LATE1', status: 'pending', result: null };
    });
    await expect(
      toolbox.run(
        'propose_create_brand',
        {
          name_en: 'A',
          name_ar: 'ا',
          mall: 'Riyadh Park',
          category: 'Fashion',
        },
        c,
      ),
    ).rejects.toThrow(/discarded/);
    expect(actions.cancel).toHaveBeenCalledWith('LATE1', -100);
    expect(c.proposal).toBeNull();
  });

  it('frees the slot when a proposal only asked for clarification', async () => {
    const c = ctx();
    await toolbox.run(
      'propose_create_brand',
      { name_en: 'A', name_ar: 'ا', mall: 'Nowhere', category: 'Fashion' },
      c,
    );
    await toolbox.run(
      'propose_create_brand',
      { name_en: 'A', name_ar: 'ا', mall: 'Riyadh Park', category: 'Fashion' },
      c,
    );
    expect(actions.create).toHaveBeenCalledTimes(1);
  });

  it('matches a property exactly even when a longer name shares the prefix', async () => {
    await toolbox.run(
      'propose_property_action',
      { property: 'riyadh park', action: 'publish' },
      ctx(),
    );
    expect(actions.create.mock.calls[0][0].payload).toMatchObject({
      propertyId: 'm1',
    });
  });

  it('allows the same name as another type or in another city', async () => {
    await toolbox.run(
      'propose_create_property',
      { type: 'outlet', name_en: 'Riyadh Park', name_ar: 'ر', city: 'Riyadh' },
      ctx(),
    );
    await toolbox.run(
      'propose_create_property',
      { type: 'mall', name_en: 'Riyadh Park', name_ar: 'ر', city: 'Jeddah' },
      ctx(),
    );
    expect(actions.create).toHaveBeenCalledTimes(2);
    const out = await toolbox.run(
      'propose_create_property',
      { type: 'mall', name_en: 'Riyadh Park', name_ar: 'ر', city: 'riyadh' },
      ctx(),
    );
    expect(out).toMatch(/already exists/);
  });
});

describe('PmToolbox roles', () => {
  const toolbox = new PmToolbox(code, targets, actions as any);
  beforeEach(() => {
    jest.clearAllMocks();
    staging.isConfigured.mockReturnValue(true);
    staging.findBrands.mockResolvedValue([{ id: 'b1', name: 'Test Brand' }]);
    staging.getBrand.mockResolvedValue({
      id: 'b1',
      name: 'Test Brand',
      stores: [{ id: 's1', name: 'x', status: 'draft', property: 'Galleria' }],
    });
  });

  it('offers the configured roles and acts as client unless told otherwise', async () => {
    const as = toolbox.specs().find((t) => t.name === 'propose_brand_action')
      ?.input_schema.properties.as as { enum: string[] };
    expect(as.enum).toEqual(['client', 'admin']);
    await toolbox.run(
      'propose_brand_action',
      { brand: 'Test Brand', action: 'publish' },
      ctx(),
    );
    expect(targets.target).toHaveBeenLastCalledWith('dev', 'client');
  });

  it('records the admin role in the proposal and shows it in the summary', async () => {
    await toolbox.run(
      'propose_brand_action',
      {
        tier: 'staging',
        as: 'admin',
        brand: 'Test Brand',
        action: 'unpublish',
      },
      ctx(),
    );
    expect(targets.target).toHaveBeenLastCalledWith('staging', 'admin');
    const call = actions.create.mock.calls[0][0];
    expect(call.payload).toMatchObject({ tier: 'staging', role: 'admin' });
    expect(call.summary).toContain('на STAGING как admin');
  });
});

describe('PmToolbox collaboration tools', () => {
  const now = Date.now();
  const remark = (over: Partial<Remark>): Remark => ({
    source: 'jira',
    where: 'ABC-1 Release',
    link: 'https://x/browse/ABC-1',
    author: 'Faisal Client',
    createdAt: new Date(now - 3 * 86_400_000),
    text: 'When will the build be ready?',
    replies: [],
    resolved: false,
    ...over,
  });
  const issues = {
    isConfigured: () => true,
    getIssue: jest
      .fn()
      .mockResolvedValue(
        'ABC-1 · Story · Open\nDescription:\nAC: 1) login works',
      ),
    recentComments: jest.fn().mockResolvedValue([
      remark({}),
      remark({ text: 'Thanks, looks good.' }),
      remark({
        author: 'Anna',
        text: 'Can QA retest?',
        replies: [{ author: 'Ira', createdAt: new Date(now) }],
      }),
    ]),
  };
  const docs = {
    isConfigured: () => true,
    recentComments: jest.fn().mockResolvedValue([
      remark({
        source: 'confluence',
        where: 'Release 1',
        text: 'Is the privacy text final?',
      }),
    ]),
  };
  const design = {
    isConfigured: () => true,
    fileKeys: () => ['FileKey12345'],
    getNodes: jest.fn().mockResolvedValue('FRAME "Home" [1:2]'),
    imageLink: jest.fn().mockResolvedValue('PNG (temporary link): https://img'),
    recentComments: jest.fn().mockResolvedValue([]),
  };
  const toolbox = new PmToolbox(code, targets, actions as any, {
    issues,
    docs,
    design,
    team: ['Ira', 'Oleksii'],
  });

  it('lists the collaboration tools when configured', () => {
    const names = toolbox.specs().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'jira_get_issue',
        'find_open_questions',
        'figma_get_node',
        'figma_image_link',
      ]),
    );
  });

  it('reads a ticket as untrusted data', async () => {
    const out = await toolbox.run('jira_get_issue', { key: 'abc-1' }, ctx());
    expect(issues.getIssue).toHaveBeenCalledWith('ABC-1');
    expect(out).toMatch(/^<tool_data source="jira:ABC-1">/);
  });

  it('finds unanswered questions by author across sources, oldest first', async () => {
    const out = await toolbox.run(
      'find_open_questions',
      { author: 'faisal' },
      ctx(),
    );
    expect(out).toContain('2 question(s) without an answer');
    expect(out).toContain('«When will the build be ready?»');
    expect(out).toContain('«Is the privacy text final?»');
    expect(out).not.toContain('looks good');
    expect(out).not.toContain('Can QA retest');
  });

  it('counts a team reply as an answer and can include answered ones', async () => {
    const out = await toolbox.run(
      'find_open_questions',
      { author: 'anna', include_answered: true },
      ctx(),
    );
    expect(out).toContain('answered by Ira');
  });

  it('limits sources when asked', async () => {
    docs.recentComments.mockClear();
    await toolbox.run('find_open_questions', { sources: ['jira'] }, ctx());
    expect(docs.recentComments).not.toHaveBeenCalled();
  });

  it('caps design images at three per message', async () => {
    const c = ctx();
    for (let i = 0; i < 3; i++)
      await toolbox.run('figma_image_link', { id: '1:2' }, c);
    await expect(
      toolbox.run('figma_image_link', { id: '1:2' }, c),
    ).rejects.toThrow(/At most 3/);
  });
});

describe('find_open_questions reliability', () => {
  const q = (over: Partial<Remark>): Remark => ({
    source: 'jira',
    where: 'ABC-1',
    link: null,
    author: 'Faisal',
    createdAt: new Date(),
    text: 'Any update?',
    replies: [],
    resolved: false,
    ...over,
  });

  it('keeps what fast sources returned when one is too slow, and says which was not read', async () => {
    jest.useFakeTimers();
    const issues = {
      isConfigured: () => true,
      getIssue: jest.fn(),
      recentComments: jest.fn().mockResolvedValue([q({})]),
    };
    const docs = {
      isConfigured: () => true,
      recentComments: jest.fn(() => new Promise<Remark[]>(() => undefined)),
    };
    const toolbox = new PmToolbox(code, targets, actions as any, {
      issues,
      docs,
    });
    const pending = toolbox.run('find_open_questions', {}, ctx());
    await jest.advanceTimersByTimeAsync(12_500);
    const out = await pending;
    jest.useRealTimers();
    expect(out).toContain(
      'Sources read: jira. NOT read: confluence (too slow)',
    );
    expect(out).toContain('«Any update?»');
  });

  it('never says "no questions" when it could not read anything', async () => {
    const docs = {
      isConfigured: () => true,
      recentComments: jest.fn().mockRejectedValue(new Error('403')),
    };
    const toolbox = new PmToolbox(code, targets, actions as any, { docs });
    const out = await toolbox.run(
      'find_open_questions',
      { sources: ['confluence', 'figma'] },
      ctx(),
    );
    expect(out).toMatch(/COULD NOT CHECK/);
    expect(out).toContain('confluence (403)');
    expect(out).toContain('figma (not configured)');
    expect(out).not.toMatch(/No matching questions/);
  });

  it('hides the tool when no source is configured', () => {
    const toolbox = new PmToolbox(code, targets, actions as any, {});
    expect(toolbox.specs().map((t) => t.name)).not.toContain(
      'find_open_questions',
    );
  });
});

describe('pickOne', () => {
  it('prefers an exact case-insensitive match, then a single partial match', () => {
    const refs = [
      { id: '1', name: 'Galleria' },
      { id: '2', name: 'Galleria Plaza' },
      { id: '3', name: 'Panorama' },
    ];
    expect(pickOne('galleria', refs).match?.id).toBe('1');
    expect(pickOne('pano', refs).match?.id).toBe('3');
    expect(pickOne('cent', refs).match).toBeNull();
  });
});

describe('untrusted helpers', () => {
  it('masks common secret shapes and assignments', () => {
    const text = redactSecrets(
      'AKIAABCDEFGHIJKLMNOP\npassword: "hunter22x"\nsk-live_abcdefghijklmnopqrstuv',
    );
    expect(text).not.toMatch(/AKIA|hunter22x|sk-live/);
    expect(text).toContain('password: [redacted]');
  });

  it('normalises and checks paths', () => {
    expect(assertReadablePath('/src/app.ts')).toBe('src/app.ts');
    expect(() =>
      assertReadablePath('android/app/google-services.json'),
    ).toThrow();
  });
});
