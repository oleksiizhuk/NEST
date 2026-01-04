import { Document } from 'mongoose';
import { ProductEntity } from '../../product/entity/product.entity';

export class ShoppingCartEntity extends Document {
  readonly id: string;
  readonly items: Array<{ count: number; item: ProductEntity }>;
  price: {
    price: number;
    discount: number;
    finalPrice: number;
  };
}
