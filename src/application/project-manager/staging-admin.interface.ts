export const STAGING_ADMIN = 'STAGING_ADMIN';

export interface NamedRef {
  id: string;
  name: string;
}

export interface NewBrand {
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

// The staging admin API of the team's product. Implementations must make
// production unreachable; every method runs against staging only.
export interface IStagingAdmin {
  isConfigured(): boolean;
  describeTarget(): string;
  findMalls(query: string): Promise<NamedRef[]>;
  findCategories(query: string): Promise<NamedRef[]>;
  findBrands(query: string): Promise<NamedRef[]>;
  createBrand(brand: NewBrand): Promise<CreatedBrand>;
}
