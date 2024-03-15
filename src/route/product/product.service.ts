import { Injectable } from '@nestjs/common';
import { IPaginationOptions } from 'nestjs-typeorm-paginate';
import { ProductRepository } from './product.repository';
import { ProductEntity } from './entity/product.entity';
import { IPaginationProduct } from './product.types';

@Injectable()
export class ProductService {
  constructor(private readonly productRepository: ProductRepository) {}

  async getProduct(options: IPaginationOptions): Promise<IPaginationProduct> {
    return this.productRepository.getProduct(options);
  }

  async getByID(id: string): Promise<ProductEntity> {
    return this.productRepository.getByID(id);
  }

  async addProduct(product): Promise<ProductEntity> {
    return this.productRepository.addProduct(product);
  }
}
