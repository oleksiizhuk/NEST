import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  IProductRepository,
  PRODUCT_REPOSITORY,
} from '@domain/product/product.repository.interface';
import { Product } from '@domain/product/product.entity';

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
    // discount is an absolute amount taken off price (see calculatePrice).
    if (dto.discount > dto.price) {
      throw new BadRequestException('discount cannot exceed price');
    }
    return this.productRepository.create(dto);
  }
}
