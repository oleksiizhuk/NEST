import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShoppingCartEntity } from './entity/shoppingCart.entity';
import { ProductEntity } from '../product/entity/product.entity';

@Injectable()
export class ShoppingCartRepository {
  constructor(
    @InjectModel('ShoppingCart')
    private shoppingCartModel: Model<ShoppingCartEntity>,
  ) {}

  private countPrice(items) {
    const price = items.reduce(
      (acc, { count, item }) => {
        return {
          price: acc.price + item.price * count,
          discount: acc.discount + item.discount * count,
          finalPrice:
            acc.finalPrice + item.price * count - item.discount * count,
        };
      },
      {
        price: 0,
        discount: 0,
        finalPrice: 0,
      },
    );
    price.finalPrice = price.price - price.discount;
    console.log('price = ', price);
    return price;
  }

  async addItem(
    cartId: string,
    item: ProductEntity,
    count: number,
  ): Promise<ShoppingCartEntity> {
    const cart = await this.shoppingCartModel.findOne({ id: cartId });
    if (!cart) {
      throw new Error('Shopping cart not found');
    }

    const existingItemIndex = cart.items.findIndex(
      (cartItem) => cartItem.item.id === item.id,
    );

    if (existingItemIndex >= 0) {
      cart.items[existingItemIndex].count += count;
    } else {
      cart.items.push({
        count,
        item,
      });
    }

    cart.price = this.countPrice(cart.items);

    await cart.save();
    return cart;
  }

  async getCart(shoppingCartId: string): Promise<ShoppingCartEntity> {
    return this.shoppingCartModel.findOne({ shoppingCartId }).lean();
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
