import { Inject, Injectable } from '@nestjs/common';
import {
  IProductRepository,
  PRODUCT_REPOSITORY,
} from '../../../domain/product/product.repository.interface';
import { IPaginationProduct } from '../../../domain/product/product.entity';

@Injectable()
export class GetProductsUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
  ) {}

  async execute(page: number, limit: number): Promise<IPaginationProduct> {
    return this.productRepository.findAll(page, limit);
  }
}
