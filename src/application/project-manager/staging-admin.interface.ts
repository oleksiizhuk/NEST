export const ADMIN_TARGETS = 'ADMIN_TARGETS';

export interface NamedRef {
  id: string;
  name: string;
}

export interface NewBrand {
  // Which test environment (e.g. dev, staging) the brand goes to
  tier: string;
  nameEn: string;
  nameAr: string;
  mallId: string;
  mallName: string;
  categoryId: string;
  categoryName: string;
  floor: string;
  wing: string;
  nearestGate: string;
  open: string;
  close: string;
}

export interface BrandTarget {
  tier: string;
  brandId: string;
  brandName: string;
}

export interface BrandStore {
  id: string;
  name: string;
  status: string;
  property: string | null;
}

export interface BrandDetails {
  id: string;
  name: string;
  stores: BrandStore[];
}

export interface PublishResult {
  done: string[];
  failed: Array<{ id: string; missingFields: string[] }>;
}

export interface CreatedBrand {
  id: string;
  name: string;
  // Human note about the result, e.g. what still blocks publishing
  note?: string;
}

// The admin API of one test environment of the team's product.
// Implementations must make production unreachable.
export interface IStagingAdmin {
  isConfigured(): boolean;
  describeTarget(): string;
  findMalls(query: string): Promise<NamedRef[]>;
  findCategories(query: string): Promise<NamedRef[]>;
  findBrands(query: string): Promise<NamedRef[]>;
  createBrand(brand: NewBrand): Promise<CreatedBrand>;
  getBrand(id: string): Promise<BrandDetails>;
  publishStores(ids: string[]): Promise<PublishResult>;
  unpublishStores(ids: string[]): Promise<PublishResult>;
  // Soft delete on the server; there is no restore through the API
  deleteBrand(id: string): Promise<void>;
}

// The test environments the bot may act on, keyed by tier name (dev,
// staging). Only tiers with a valid allowlisted URL and credentials appear.
export interface IAdminTargets {
  tiers(): string[];
  // Throws for an unknown or unconfigured tier
  target(tier: string): IStagingAdmin;
}
