import { Inject, Injectable } from '@nestjs/common';
import {
  IProductRepository,
  PRODUCT_REPOSITORY,
} from '../../../domain/product/product.repository.interface';
import { Product } from '../../../domain/product/product.entity';

export interface AddProductDto {
  age: number;
  type: string;
  imageUrl: string;
  name: string;
  snippet: string;
  price: number;
  discount: number;
  screen: string;
  capacity: string;
  ram: string;
}

@Injectable()
export class AddProductUseCase {
  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
  ) {}

  async execute(dto: AddProductDto): Promise<Product> {
    return this.productRepository.create(dto);
  }
}
