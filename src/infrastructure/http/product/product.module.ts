import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductController } from '@infrastructure/http/product/product.controller';
import { ProductSchema } from '@infrastructure/database/schemas/product.schema';
import { MongoProductRepository } from '@infrastructure/database/repositories/mongo-product.repository';
import { PRODUCT_REPOSITORY } from '@domain/product/product.repository.interface';
import { GetProductsUseCase } from '@application/product/use-cases/get-products.use-case';
import { GetProductByIdUseCase } from '@application/product/use-cases/get-product-by-id.use-case';
import { AddProductUseCase } from '@application/product/use-cases/add-product.use-case';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'Product', schema: ProductSchema }]),
  ],
  controllers: [ProductController],
  providers: [
    { provide: PRODUCT_REPOSITORY, useClass: MongoProductRepository },
    GetProductsUseCase,
    GetProductByIdUseCase,
    AddProductUseCase,
  ],
  exports: [PRODUCT_REPOSITORY, GetProductByIdUseCase],
})
export class ProductModule {}
