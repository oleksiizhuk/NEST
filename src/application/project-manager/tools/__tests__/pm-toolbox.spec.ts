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
  findMalls: jest.fn(),
  findCategories: jest.fn(),
  findBrands: jest.fn(),
  createBrand: jest.fn(),
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
  mall: 'Centria',
  category: 'Fashion',
};

describe('PmToolbox', () => {
  const toolbox = new PmToolbox(code, staging, actions as any);
  beforeEach(() => {
    jest.clearAllMocks();
    staging.isConfigured.mockReturnValue(true);
    staging.findMalls.mockResolvedValue([
      { id: 'm1', name: 'Centria' },
      { id: 'm2', name: 'Centria Plaza' },
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
    expect(out).toContain('Centria (id m1)');
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('refuses to propose a brand that already exists', async () => {
    staging.findBrands.mockResolvedValue([{ id: 'b9', name: 'test brand' }]);
    const out = await toolbox.run('propose_create_brand', brandInput, ctx());
    expect(out).toMatch(/already exists on staging \(id b9\)/);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('reports staging as unavailable when it is not configured', async () => {
    staging.isConfigured.mockReturnValue(false);
    await expect(
      toolbox.run('staging_lookup', { entity: 'mall', query: 'x' }, ctx()),
    ).rejects.toThrow(/not configured/);
  });
});

describe('pickOne', () => {
  it('prefers an exact case-insensitive match, then a single partial match', () => {
    const refs = [
      { id: '1', name: 'Centria' },
      { id: '2', name: 'Centria Plaza' },
      { id: '3', name: 'Panorama' },
    ];
    expect(pickOne('centria', refs).match?.id).toBe('1');
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
