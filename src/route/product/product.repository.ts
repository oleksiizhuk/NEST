import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductEntity } from './entity/product.entity';
import { Pagination, IPaginationOptions } from 'nestjs-typeorm-paginate';
import { Model } from 'mongoose';
import { ProductDTO } from './dto/product.dto';

@Injectable()
export class ProductRepository {
  constructor(
    @InjectModel('Product') private productModel: Model<ProductEntity>,
  ) {}

  // Promise<Pagination<ProductEntity>>
  async getProduct(options: IPaginationOptions): Promise<any> {
    const page = +options.page;
    const limit = +options.limit;
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
    // console.log(new Pagination(results, meta));
    // return new Pagination(results, meta);
    return { meta };
  }

  async getByID(id: string): Promise<ProductEntity> {
    const product = await this.productModel.findById(id).exec();
    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }
    return product;
  }

  async addProduct(productData: ProductDTO): Promise<ProductEntity> {
    const newProduct = new this.productModel(productData);
    await newProduct.save();
    return newProduct;
  }
}
