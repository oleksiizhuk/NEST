import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BrandDetails,
  NewProperty,
  StoreChanges,
  CreatedBrand,
  PublishResult,
  IAdminTargets,
  IStagingAdmin,
  NamedRef,
  NewBrand,
} from '@application/project-manager/staging-admin.interface';
import { StagingHttpError } from '@application/project-manager/use-cases/confirm-pending-action.use-case';
import { placeholderPng } from '@infrastructure/staging-admin/placeholder-png';

const TIMEOUT_MS = 20_000;
// Access tokens on the admin API are short-lived; re-login well before
const TOKEN_TTL_MS = 60_000;
const WEEK = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
// Used only when the mall record carries no coordinates
const FALLBACK_POINT = { latitude: 24.7136, longitude: 46.6753 };

type Json = Record<string, any>;

const listOf = (d: any): any[] =>
  Array.isArray(d) ? d : d?.data ?? d?.items ?? d?.body ?? [];

const nameOf = (item: Json): string =>
  typeof item?.name === 'string'
    ? item.name
    : item?.name?.en ?? item?.name?.ar ?? '?';

// Fails closed: HTTPS only, the exact host must be allowlisted, and a host
// on the forbidden list (production) can never be configured.
export const checkStagingBase = (
  base: string,
  allowedHosts: string[],
  forbiddenHosts: string[],
): URL | null => {
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') return null;
    if (!allowedHosts.includes(url.hostname)) return null;
    if (
      forbiddenHosts.some(
        (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
      )
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

// One test environment; settings come from <PREFIX>_* env vars.
export class HttpStagingAdmin implements IStagingAdmin {
  private readonly logger = new Logger(HttpStagingAdmin.name);
  private readonly base: URL | null;
  private readonly email: string;
  private readonly password: string;
  private token: { value: string; until: number } | null = null;
  private loggingIn: Promise<string> | null = null;
  // The admin API updates the session on every request, and concurrent
  // requests on one session deadlock there; it also allows ~10 req/min.
  // So requests to one environment run strictly one after another.
  private queue: Promise<unknown> = Promise.resolve();
  private company: string | null = null;

  constructor(config: ConfigService, prefix = 'STAGING') {
    const list = (key: string) =>
      (config.get<string>(key) ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
    this.base = checkStagingBase(
      config.get<string>(`${prefix}_API_BASE_URL`) ?? '',
      list(`${prefix}_ALLOWED_HOSTS`),
      [
        ...list(`${prefix}_FORBIDDEN_HOSTS`),
        // The production blocklist is shared by every tier
        ...list('STAGING_FORBIDDEN_HOSTS'),
        ...list('PM_FORBIDDEN_HOSTS'),
      ],
    );
    this.email = config.get<string>(`${prefix}_ADMIN_EMAIL`) ?? '';
    this.password = config.get<string>(`${prefix}_ADMIN_PASSWORD`) ?? '';
  }

  isConfigured(): boolean {
    return Boolean(this.base && this.email && this.password);
  }

  describeTarget(): string {
    return this.base?.hostname ?? 'not configured';
  }

  async findMalls(query: string): Promise<NamedRef[]> {
    const q = encodeURIComponent(query);
    const data = await this.call('GET', `/properties/short?search=${q}`);
    return listOf(data).map((p: Json) => ({
      id: String(p.id),
      name: `${nameOf(p)}${p.type ? ` (${p.type})` : ''}`,
    }));
  }

  async findCategories(query: string): Promise<NamedRef[]> {
    const cid = await this.companyId();
    const data = await this.call(
      'GET',
      `/companies/${cid}/businesses/brands/business-categories${
        query ? `?search=${encodeURIComponent(query)}` : ''
      }`,
    );
    return listOf(data).map((c: Json) => ({
      id: String(c.id),
      name: nameOf(c),
    }));
  }

  async findBrands(query: string): Promise<NamedRef[]> {
    const cid = await this.companyId();
    const data = await this.call(
      'GET',
      `/companies/${cid}/businesses/brands?search=${encodeURIComponent(
        query,
      )}&page=1&pageSize=20`,
    );
    return listOf(data).map((b: Json) => ({
      id: String(b.id),
      name: nameOf(b),
    }));
  }

  async createBrand(brand: NewBrand): Promise<CreatedBrand> {
    const cid = await this.companyId();
    // One upload serves as both logo and storefront image: the staging API
    // allows only ~10 requests a minute per IP
    const [logo, point] = await Promise.all([
      this.upload('/image-uploader/images', 'files'),
      this.mallPoint(brand.mallId),
    ]);
    const image = logo;
    const body = {
      name: { en: brand.nameEn, ar: brand.nameAr },
      logo,
      propertyIds: [brand.mallId],
      stores: [
        {
          propertyId: brand.mallId,
          name: { en: brand.nameEn, ar: brand.nameAr },
          image,
          categoryIds: [brand.categoryId],
          type: 'single_store',
          brandsMode: 'single',
          gender: 'all',
          coordinates: point,
          wing: brand.wing || null,
          nearestGate: brand.nearestGate || null,
          floor: brand.floor || null,
          workSchedule: {
            regular: [{ days: WEEK, open: brand.open, close: brand.close }],
            specialDates: [],
            sharedCalendar: [],
          },
        },
      ],
    };
    const created = await this.call(
      'POST',
      `/companies/${cid}/businesses/brands`,
      body,
    );
    const id = created?.id ?? created?.body?.id;
    if (!id) throw new StagingHttpError(502, 'staging returned no brand id');
    // Stores start as drafts; report what still blocks publishing
    const missing = (created?.missingFields ?? [])
      .map((f: Json) => f?.field)
      .filter(Boolean);
    return {
      id: String(id),
      name: brand.nameEn,
      note: created?.canPublish
        ? 'магазин создан черновиком — его можно опубликовать в дашборде'
        : `магазин в черновике${
            missing.length
              ? `; для публикации не хватает: ${missing.join(', ')}`
              : ''
          }`,
    };
  }

  async getBrand(id: string): Promise<BrandDetails> {
    const b = await this.call(
      'GET',
      `/businesses/brands/${encodeURIComponent(id)}`,
    );
    const brand = b?.body ?? b;
    const stores: Json[] = Array.isArray(brand?.stores) ? brand.stores : [];
    return {
      id: String(brand?.id ?? id),
      name: nameOf(brand),
      stores: stores.map((st) => ({
        id: String(st.id),
        name: nameOf(st),
        status: String(st.status ?? 'unknown'),
        property:
          (st.property && nameOf(st.property)) ??
          (st.propertyName as string | undefined) ??
          (st.propertyId ? String(st.propertyId) : null),
      })),
    };
  }

  publishStores(ids: string[]): Promise<PublishResult> {
    return this.storeStatus('publish', ids);
  }

  unpublishStores(ids: string[]): Promise<PublishResult> {
    return this.storeStatus('unpublish', ids);
  }

  async deleteBrand(id: string): Promise<void> {
    await this.call('DELETE', `/businesses/brands/${encodeURIComponent(id)}`);
  }

  async updateStore(
    brandId: string,
    storeId: string,
    changes: StoreChanges,
  ): Promise<void> {
    const raw = await this.call(
      'GET',
      `/businesses/brands/${encodeURIComponent(brandId)}`,
    );
    const brand = raw?.body ?? raw;
    const stores: Json[] = Array.isArray(brand?.stores) ? brand.stores : [];
    if (!stores.some((st) => String(st.id) === storeId)) {
      throw new StagingHttpError(
        404,
        `store ${storeId} is not in brand ${brandId}`,
      );
    }
    // Only the fields the update DTO accepts, taken from what the API returned
    const body = {
      stores: stores.map((st) => {
        const store: Json = {
          id: st.id,
          propertyId: st.propertyId ?? st.property?.id,
          name: st.name,
          categoryIds: st.categoryIds ?? [],
          coordinates: st.coordinates ?? null,
          wing: st.wing ?? null,
          nearestGate: st.nearestGate ?? null,
          floor: st.floor ?? null,
          workSchedule: st.workSchedule ?? { regular: [] },
          image: st.image ?? null,
          gender: st.gender ?? null,
          type: st.type ?? null,
          brandsMode: st.brandsMode ?? null,
          ...(st.brandsMode === 'multiple'
            ? { representedBrands: st.representedBrands ?? [] }
            : {}),
        };
        if (String(st.id) !== storeId) return store;
        const name = { ...(store.name ?? {}) };
        if (changes.nameEn !== undefined) name.en = changes.nameEn;
        if (changes.nameAr !== undefined) name.ar = changes.nameAr;
        store.name = name;
        if (changes.floor !== undefined) store.floor = changes.floor;
        if (changes.wing !== undefined) store.wing = changes.wing;
        if (changes.nearestGate !== undefined)
          store.nearestGate = changes.nearestGate;
        if (changes.categoryId !== undefined)
          store.categoryIds = [changes.categoryId];
        if (changes.open !== undefined || changes.close !== undefined) {
          const first = store.workSchedule?.regular?.[0] ?? {};
          store.workSchedule = {
            ...(store.workSchedule ?? {}),
            regular: [
              {
                days: WEEK,
                open: changes.open ?? first.open ?? '10:00',
                close: changes.close ?? first.close ?? '22:00',
              },
            ],
          };
        }
        return store;
      }),
    };
    await this.call(
      'PUT',
      `/businesses/brands/${encodeURIComponent(brandId)}`,
      body,
    );
  }

  async createProperty(property: NewProperty): Promise<CreatedBrand> {
    const cid = await this.companyId();
    const hasPoint = property.latitude !== null && property.longitude !== null;
    const address = {
      city: { en: property.city, ar: property.city },
      ...(property.district
        ? { district: { en: property.district, ar: property.district } }
        : {}),
      ...(property.street
        ? { street: { en: property.street, ar: property.street } }
        : {}),
      ...(hasPoint
        ? {
            geoLocation: {
              latitude: property.latitude,
              longitude: property.longitude,
            },
          }
        : {}),
    };
    const created = await this.call('POST', `/companies/${cid}/properties`, {
      type: property.type,
      name: { en: property.nameEn, ar: property.nameAr },
      address,
    });
    const id = created?.id ?? created?.body?.id;
    if (!id) throw new StagingHttpError(502, 'staging returned no property id');
    return {
      id: String(id),
      name: property.nameEn,
      note: 'создан черновиком — опубликовать можно отдельным действием или в дашборде',
    };
  }

  publishProperties(ids: string[]): Promise<PublishResult> {
    return this.statusChange('/properties', 'publish', ids);
  }

  unpublishProperties(ids: string[]): Promise<PublishResult> {
    return this.statusChange('/properties', 'unpublish', ids);
  }

  private storeStatus(
    verb: 'publish' | 'unpublish',
    ids: string[],
  ): Promise<PublishResult> {
    return this.statusChange('/businesses/stores', verb, ids);
  }

  private async statusChange(
    base: string,
    verb: 'publish' | 'unpublish',
    ids: string[],
  ): Promise<PublishResult> {
    const data = await this.call('POST', `${base}/${verb}`, { ids });
    const done: unknown[] = data?.published ?? data?.unpublished ?? [];
    const failed: Json[] = data?.failed ?? [];
    return {
      done: done.map((x) => String((x as Json)?.id ?? x)),
      failed: failed.map((f) => ({
        id: String(f.id),
        missingFields: (f.missingFields ?? []).map((m: Json | string) =>
          typeof m === 'string' ? m : String(m?.field ?? m?.code ?? '?'),
        ),
      })),
    };
  }

  private async mallPoint(
    id: string,
  ): Promise<{ latitude: number; longitude: number }> {
    try {
      const p = await this.call('GET', `/properties/${encodeURIComponent(id)}`);
      const geo =
        p?.address?.geoLocation ??
        p?.coordinates ??
        p?.location ??
        p?.body?.address?.geoLocation;
      const latitude = Number(geo?.latitude ?? geo?.lat);
      const longitude = Number(geo?.longitude ?? geo?.lng ?? geo?.lon);
      if (Number.isFinite(latitude) && Number.isFinite(longitude))
        return { latitude, longitude };
    } catch (error) {
      this.logger.warn(
        `mall ${id} coordinates unavailable: ${(error as Error).message}`,
      );
    }
    return FALLBACK_POINT;
  }

  private async upload(path: string, field: string): Promise<string> {
    const form = new FormData();
    form.append(
      field,
      new Blob([new Uint8Array(placeholderPng())], { type: 'image/png' }),
      'bot-placeholder.png',
    );
    const data = await this.call('POST', path, form);
    const url =
      data?.imageUrl ??
      data?.imageUrls?.[0] ??
      data?.body?.imageUrl ??
      data?.body?.imageUrls?.[0];
    if (!url)
      throw new StagingHttpError(502, `upload to ${path} returned no url`);
    return String(url);
  }

  private async companyId(): Promise<string> {
    if (this.company) return this.company;
    const own = await this.call('GET', '/companies/own');
    const id = (own?.company ?? own?.body?.company ?? own)?.id;
    if (!id)
      throw new StagingHttpError(502, 'no own company for the staging account');
    this.company = String(id);
    return this.company;
  }

  // One login shared by every concurrent caller
  private login(): Promise<string> {
    if (this.token && this.token.until > Date.now()) {
      return Promise.resolve(this.token.value);
    }
    if (!this.loggingIn) {
      this.loggingIn = this.raw('POST', '/auth/login', {
        email: this.email,
        password: this.password,
      })
        .then((data) => {
          const value = data?.accessToken ?? data?.body?.accessToken;
          if (!value) {
            throw new StagingHttpError(401, 'login returned no token');
          }
          this.token = { value, until: Date.now() + TOKEN_TTL_MS };
          return value as string;
        })
        .finally(() => {
          this.loggingIn = null;
        });
    }
    return this.loggingIn;
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private call(method: string, path: string, body?: unknown): Promise<any> {
    return this.serial(() => this.callNow(method, path, body));
  }

  private async callNow(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const token = await this.login();
    try {
      return await this.raw(method, path, body, token);
    } catch (error) {
      if (error instanceof StagingHttpError && error.status === 401) {
        this.token = null;
        return this.raw(method, path, body, await this.login());
      }
      throw error;
    }
  }

  private async raw(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<any> {
    if (!this.base) throw new StagingHttpError(0, 'staging is not configured');
    const url = new URL(path, this.base);
    if (url.host !== this.base.host)
      throw new StagingHttpError(0, 'refusing to leave the staging host');
    const isForm = body instanceof FormData;
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !isForm
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body:
        body === undefined
          ? undefined
          : isForm
          ? (body as FormData)
          : JSON.stringify(body),
    });
    if (response.status === 429) {
      throw new StagingHttpError(
        429,
        `staging rate limit, retry after ${
          response.headers.get('retry-after') ?? 60
        }s`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw new StagingHttpError(
        response.status,
        'unexpected redirect refused',
      );
    }
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const message = Array.isArray(data?.message)
        ? data.message.join('; ')
        : data?.message ?? String(text).slice(0, 300);
      throw new StagingHttpError(response.status, String(message));
    }
    return data;
  }
}

// dev → DEV_*, staging → STAGING_*. Order is the default order the model sees.
const TIER_PREFIXES: Array<[string, string]> = [
  ['dev', 'DEV'],
  ['staging', 'STAGING'],
];

export class AdminTargets implements IAdminTargets {
  private readonly byTier = new Map<string, IStagingAdmin>();

  constructor(config: ConfigService) {
    for (const [tier, prefix] of TIER_PREFIXES) {
      const admin = new HttpStagingAdmin(config, prefix);
      if (admin.isConfigured()) this.byTier.set(tier, admin);
    }
  }

  tiers(): string[] {
    return [...this.byTier.keys()];
  }

  target(tier: string): IStagingAdmin {
    const admin = this.byTier.get(tier);
    if (!admin) throw new Error(`Environment "${tier}" is not configured`);
    return admin;
  }
}
