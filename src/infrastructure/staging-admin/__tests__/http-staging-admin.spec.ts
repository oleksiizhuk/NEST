import {
  AdminTargets,
  checkStagingBase,
  HttpStagingAdmin,
} from '@infrastructure/staging-admin/http-staging-admin';
import { placeholderPng } from '@infrastructure/staging-admin/placeholder-png';

const env = (values: Record<string, string>) =>
  ({ get: (k: string) => values[k] } as any);
const ok = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
const staging = {
  STAGING_API_BASE_URL: 'https://api.staging.example',
  STAGING_ALLOWED_HOSTS: 'api.staging.example',
  STAGING_FORBIDDEN_HOSTS: 'prod.example',
  STAGING_ADMIN_EMAIL: 'bot@example.com',
  STAGING_ADMIN_PASSWORD: 'pw',
};

describe('checkStagingBase', () => {
  it('accepts only an allowlisted https host that is not forbidden', () => {
    expect(
      checkStagingBase(
        'https://api.staging.example',
        ['api.staging.example'],
        [],
      )?.hostname,
    ).toBe('api.staging.example');
    expect(
      checkStagingBase(
        'http://api.staging.example',
        ['api.staging.example'],
        [],
      ),
    ).toBeNull();
    expect(
      checkStagingBase('https://api.prod.example', ['api.staging.example'], []),
    ).toBeNull();
    expect(
      checkStagingBase(
        'https://api.prod.example',
        ['api.prod.example'],
        ['prod.example'],
      ),
    ).toBeNull();
    expect(checkStagingBase('not a url', ['x'], [])).toBeNull();
  });
});

describe('HttpStagingAdmin', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('stays off when the base URL is not allowlisted (fails closed)', () => {
    expect(
      new HttpStagingAdmin(
        env({ ...staging, STAGING_ALLOWED_HOSTS: '' }),
      ).isConfigured(),
    ).toBe(false);
    expect(
      new HttpStagingAdmin(
        env({ ...staging, STAGING_ADMIN_PASSWORD: '' }),
      ).isConfigured(),
    ).toBe(false);
  });

  it('logs in once, then creates the brand with one upload and the store in the mall', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    global.fetch = jest.fn((url: URL, init: RequestInit) => {
      const path = url.pathname;
      calls.push({
        url: String(url),
        method: init.method ?? 'GET',
        body: init.body,
      });
      if (path === '/auth/login') return ok({ accessToken: 'jwt' }, 201);
      if (path === '/companies/own') return ok({ company: { id: 'co1' } });
      if (path === '/image-uploader/images')
        return ok({ imageUrls: ['https://cdn/x.png'] }, 201);
      if (path === '/properties/m1')
        return ok({
          address: { geoLocation: { latitude: 24.1, longitude: 46.2 } },
        });
      if (path === '/companies/co1/businesses/brands')
        return ok({ id: 'b1', canPublish: true, missingFields: [] }, 201);
      return ok({ message: 'not found' }, 404);
    }) as any;

    const admin = new HttpStagingAdmin(env(staging));
    const brand = await admin.createBrand({
      tier: 'staging',
      nameEn: 'Test Brand',
      nameAr: 'تست',
      mallId: 'm1',
      mallName: 'Galleria',
      categoryId: 'c1',
      categoryName: 'Fashion',
      floor: 'L1',
      wing: 'A',
      nearestGate: 'G1',
      open: '10:00',
      close: '22:00',
    });

    expect(brand).toEqual({
      id: 'b1',
      name: 'Test Brand',
      note: expect.stringContaining('черновиком'),
    });
    expect(calls.filter((c) => c.url.endsWith('/auth/login'))).toHaveLength(1);
    expect(
      calls.filter((c) => c.url.includes('/image-uploader/')),
    ).toHaveLength(1);
    expect(
      calls.every((c) => c.url.startsWith('https://api.staging.example/')),
    ).toBe(true);
    const create = calls.find((c) =>
      c.url.endsWith('/companies/co1/businesses/brands'),
    );
    const body = JSON.parse(String(create?.body));
    expect(body).toMatchObject({
      name: { en: 'Test Brand', ar: 'تست' },
      logo: 'https://cdn/x.png',
      propertyIds: ['m1'],
      stores: [
        {
          propertyId: 'm1',
          categoryIds: ['c1'],
          coordinates: { latitude: 24.1, longitude: 46.2 },
          image: 'https://cdn/x.png',
          type: 'single_store',
          brandsMode: 'single',
          gender: 'all',
        },
      ],
    });
    expect(body.stores[0].workSchedule.regular[0].days).toHaveLength(7);
  });

  it('turns a 429 into a readable rate-limit error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '42' }),
        text: () => Promise.resolve(''),
      }),
    ) as any;
    await expect(
      new HttpStagingAdmin(env(staging)).findMalls('x'),
    ).rejects.toThrow(/rate limit, retry after 42s/);
  });
});

describe('placeholderPng', () => {
  it('is a real PNG well under the logo size limit', () => {
    const png = placeholderPng();
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.length).toBeLessThan(500_000);
  });
});

describe('AdminTargets', () => {
  it('builds one client per configured environment from its own prefix', () => {
    const targets = new AdminTargets(
      env({
        ...staging,
        DEV_API_BASE_URL: 'https://api.dev.example',
        DEV_ALLOWED_HOSTS: 'api.dev.example',
        DEV_ADMIN_EMAIL: 'dev@example.com',
        DEV_ADMIN_PASSWORD: 'pw',
      }),
    );
    expect(targets.tiers()).toEqual(['dev', 'staging']);
    expect(targets.target('dev').describeTarget()).toBe('api.dev.example');
    expect(() => targets.target('production')).toThrow(/not configured/);
  });

  it('applies the shared production blocklist to every environment', () => {
    const targets = new AdminTargets(
      env({
        STAGING_FORBIDDEN_HOSTS: 'prod.example',
        DEV_API_BASE_URL: 'https://api.prod.example',
        DEV_ALLOWED_HOSTS: 'api.prod.example',
        DEV_ADMIN_EMAIL: 'x',
        DEV_ADMIN_PASSWORD: 'y',
      }),
    );
    expect(targets.tiers()).toEqual([]);
  });
});

describe('HttpStagingAdmin concurrency', () => {
  const realFetch = global.fetch;
  afterEach(() => (global.fetch = realFetch));

  it('logs in once and never runs two requests at the same time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const paths: string[] = [];
    global.fetch = jest.fn(async (url: URL) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      paths.push(url.pathname);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      const data =
        url.pathname === '/auth/login'
          ? { accessToken: 'jwt' }
          : url.pathname === '/companies/own'
          ? { company: { id: 'co1' } }
          : { data: [{ id: '1', name: { en: 'X' } }] };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify(data),
      };
    }) as any;

    const admin = new HttpStagingAdmin(env(staging));
    await Promise.all([
      admin.findMalls(''),
      admin.findCategories(''),
      admin.findBrands('x'),
    ]);

    expect(paths.filter((p) => p === '/auth/login')).toHaveLength(1);
    expect(maxInFlight).toBe(1);
  });
});
