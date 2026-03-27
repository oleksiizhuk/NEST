import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IShoppingCartRepository } from '@domain/shopping-cart/shopping-cart.repository.interface';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';
import { Product } from '@domain/product/product.entity';
import { ShoppingCartDocument } from '@infrastructure/database/schemas/shopping-cart.schema';
import { ShoppingCartMapper } from '@infrastructure/database/mappers/shopping-cart.mapper';

@Injectable()
export class MongoShoppingCartRepository implements IShoppingCartRepository {
  constructor(
    @InjectModel('ShoppingCart') private cartModel: Model<ShoppingCartDocument>,
  ) {}

  async findById(cartId: string): Promise<ShoppingCart | null> {
    const doc = await this.cartModel.findOne({ id: cartId }).lean();
    return doc
      ? ShoppingCartMapper.toDomain(doc as ShoppingCartDocument)
      : null;
  }

  async create(id: string): Promise<ShoppingCart> {
    const doc = await new this.cartModel({
      id,
      items: [],
      price: { price: 0, discount: 0, finalPrice: 0 },
    }).save();
    return ShoppingCartMapper.toDomain(doc);
  }

  async addItem(
    cartId: string,
    item: Product,
    count: number,
  ): Promise<ShoppingCart> {
    const doc = await this.cartModel.findOne({ id: cartId });
    if (!doc) {
      throw new Error('Shopping cart not found');
    }

    const existingIndex = doc.items.findIndex(
      (ci) => (ci.item as any).id === item.id,
    );
    if (existingIndex >= 0) {
      doc.items[existingIndex].count += count;
    } else {
      doc.items.push({ count, item: item as any });
    }

    doc.price = ShoppingCart.calculatePrice(
      doc.items.map((ci) => ({ count: ci.count, item: item })),
    ) as any;

    await doc.save();
    return ShoppingCartMapper.toDomain(doc);
  }
}
