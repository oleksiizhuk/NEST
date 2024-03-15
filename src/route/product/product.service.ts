import { Injectable } from '@nestjs/common';
import { Pagination, IPaginationOptions } from 'nestjs-typeorm-paginate';
import { ProductRepository } from './product.repository';
import { ProductEntity } from './entity/product.entity';

@Injectable()
export class ProductService {
  constructor(private readonly productRepository: ProductRepository) {}

  async getProduct(
    options: IPaginationOptions,
  ): Promise<Pagination<ProductEntity>> {
    return this.productRepository.getProduct(options);
  }

  async getByID(id: string): Promise<ProductEntity> {
    return this.productRepository.getByID(id);
  }

  async addProduct(product): Promise<ProductEntity> {
    return this.productRepository.addProduct(product);
  }
}
