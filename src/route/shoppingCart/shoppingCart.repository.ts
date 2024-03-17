import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShoppingCartEntity } from './entity/shoppingCart.entity';

@Injectable()
export class ShoppingCartRepository {
  constructor(
    @InjectModel('ShoppingCart')
    private productModel: Model<ShoppingCartEntity>,
  ) {}

  async add(): Promise<ShoppingCartEntity> {
    return {} as any;
  }
}
