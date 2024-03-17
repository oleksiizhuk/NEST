import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShoppingCartEntity } from './entity/shoppingCart.entity';

@Injectable()
export class ShoppingCartRepository {
  constructor(
    @InjectModel('ShoppingCart')
    private shoppingCartModel: Model<ShoppingCartEntity>,
  ) {}

  async add(id: string): Promise<ShoppingCartEntity> {
    return {} as any;
  }

  async getCart(id: string): Promise<ShoppingCartEntity> {
    return this.shoppingCartModel.findOne({ id }).lean();
  }

  async createShoppingCart(id: string): Promise<ShoppingCartEntity> {
    const newCart = await new this.shoppingCartModel({
      id: id,
      items: [],
      price: { count: 0 },
    });
    return newCart.save();
  }
}
