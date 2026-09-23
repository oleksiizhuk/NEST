import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IShoppingCartRepository } from '@domain/shopping-cart/shopping-cart.repository.interface';
import { ShoppingCart } from '@domain/shopping-cart/shopping-cart.entity';
import { ShoppingCartDocument } from '@infrastructure/database/schemas/shopping-cart.schema';
import { ShoppingCartMapper } from '@infrastructure/database/mappers/shopping-cart.mapper';

@Injectable()
export class MongoShoppingCartRepository implements IShoppingCartRepository {
  constructor(
    @InjectModel('ShoppingCart') private cartModel: Model<ShoppingCartDocument>,
  ) {}

  // items.item is a Product reference; populate it so the domain sees
  // real products (a deleted product comes back null and is dropped).
  async findById(cartId: string): Promise<ShoppingCart | null> {
    const doc = await this.cartModel
      .findOne({ id: cartId })
      .populate('items.item')
      .lean();
    return doc
      ? ShoppingCartMapper.toDomain(doc as unknown as ShoppingCartDocument)
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

  async save(cart: ShoppingCart): Promise<ShoppingCart> {
    await this.cartModel.updateOne(
      { id: cart.id },
      {
        $set: {
          items: cart.items.map(({ count, item }) => ({
            count,
            item: item.id,
          })),
          price: cart.price,
        },
      },
    );
    return cart;
  }

  async delete(cartId: string): Promise<void> {
    await this.cartModel.deleteOne({ id: cartId });
  }
}
