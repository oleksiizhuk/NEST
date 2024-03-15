import { ProductEntity } from './entity/product.entity';

export interface IPaginationProduct {
  items: ProductEntity[];
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  totalPages: number;
  currentPage: number;
}
