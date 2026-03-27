import { Product, IPaginationProduct } from './product.entity';

export const PRODUCT_REPOSITORY = 'PRODUCT_REPOSITORY';

export interface IProductRepository {
  findAll(page: number, limit: number): Promise<IPaginationProduct>;
  findById(id: string): Promise<Product | null>;
  create(data: Omit<Product, 'id'>): Promise<Product>;
}
