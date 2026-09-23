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

export interface StoreChanges {
  nameEn?: string;
  nameAr?: string;
  floor?: string | null;
  wing?: string | null;
  nearestGate?: string | null;
  open?: string;
  close?: string;
  categoryId?: string;
}

export interface StoreEdit {
  tier: string;
  brandId: string;
  brandName: string;
  storeId: string;
  storeLabel: string;
  changes: StoreChanges;
}

export type PropertyType = 'mall' | 'outlet' | 'plaza';

export interface NewProperty {
  tier: string;
  type: PropertyType;
  nameEn: string;
  nameAr: string;
  city: string;
  district: string | null;
  street: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PropertyTarget {
  tier: string;
  propertyId: string;
  propertyName: string;
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
  // Rewrites the brand's whole store list with one store changed: the API
  // replaces the list on update, so the others are sent back untouched
  updateStore(
    brandId: string,
    storeId: string,
    changes: StoreChanges,
  ): Promise<void>;
  createProperty(property: NewProperty): Promise<CreatedBrand>;
  publishProperties(ids: string[]): Promise<PublishResult>;
  unpublishProperties(ids: string[]): Promise<PublishResult>;
}

// The test environments the bot may act on, keyed by tier name (dev,
// staging). Only tiers with a valid allowlisted URL and credentials appear.
export interface IAdminTargets {
  tiers(): string[];
  // Throws for an unknown or unconfigured tier
  target(tier: string): IStagingAdmin;
}
