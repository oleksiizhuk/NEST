import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IProductRepository } from '../../../domain/product/product.repository.interface';
import { Product, IPaginationProduct } from '../../../domain/product/product.entity';
import { ProductDocument } from '../schemas/product.schema';
import { ProductMapper } from '../mappers/product.mapper';

@Injectable()
export class MongoProductRepository implements IProductRepository {
  constructor(@InjectModel('Product') private productModel: Model<ProductDocument>) {}

  async findAll(page: number, limit: number): Promise<IPaginationProduct> {
    const [docs, total] = await Promise.all([
      this.productModel
        .find()
        .skip((page - 1) * limit)
        .limit(limit),
      this.productModel.countDocuments(),
    ]);

    return {
      items: docs.map(ProductMapper.toDomain),
      totalItems: total,
      itemCount: docs.length,
      itemsPerPage: limit,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async findById(id: string): Promise<Product | null> {
    const doc = await this.productModel.findById(id).exec();
    return doc ? ProductMapper.toDomain(doc) : null;
  }

  async create(data: Omit<Product, 'id'>): Promise<Product> {
    const doc = new this.productModel(data);
    await doc.save();
    return ProductMapper.toDomain(doc);
  }
}