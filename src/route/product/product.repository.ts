import { Injectable, NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { ProductEntity } from './entity/product.entity';
import { Pagination, IPaginationOptions } from 'nestjs-typeorm-paginate';

@Injectable()
export class ProductRepository {
  constructor(
    @InjectModel('Product') private productModel: Model<ProductEntity>,
  ) {}

  async getProduct(
    options: IPaginationOptions,
  ): Promise<Pagination<ProductEntity>> {
    const page = +options.page || 1;
    const limit = +options.limit || 10;
    const [results, total] = await Promise.all([
      this.productModel
        .find()
        .skip((page - 1) * limit)
        .limit(limit),
      this.productModel.countDocuments(),
    ]);

    const totalPages = Math.ceil(total / limit);
    const meta = {
      totalItems: total,
      itemCount: results.length,
      itemsPerPage: limit,
      totalPages: totalPages,
      currentPage: page,
    };

    return new Pagination(results, meta);
  }

  async getByID(id: string): Promise<ProductEntity> {
    const product = await this.productModel.findById(id).exec();
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    return product;
  }
}
