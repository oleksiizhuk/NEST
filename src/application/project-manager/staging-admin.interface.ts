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
}

// The test environments the bot may act on, keyed by tier name (dev,
// staging). Only tiers with a valid allowlisted URL and credentials appear.
export interface IAdminTargets {
  tiers(): string[];
  // Throws for an unknown or unconfigured tier
  target(tier: string): IStagingAdmin;
}
