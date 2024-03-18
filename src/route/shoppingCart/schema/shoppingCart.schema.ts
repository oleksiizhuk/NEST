import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { Document, Types } from 'mongoose';
import { Product } from '../../product/schema/product.schema';

class Price {
  @Prop({ required: true })
  price: number;

  @Prop({ required: true })
  discount: number;

  @Prop({ required: true })
  finalPrice: number;
}

@Schema({ timestamps: true })
export class ShoppingCart extends Document {
  @Prop({ required: true })
  id: string;

  @Prop({
    type: [
      {
        count: { type: Number, required: true },
        item: { type: Types.ObjectId, ref: 'Product', required: true },
      },
    ],
  })
  @Type(() => Product)
  items: Array<{ count: number; item: Product }>;

  @Prop({ type: Price, required: true })
  price: Price;
}

export const ShoppingCartSchema = SchemaFactory.createForClass(ShoppingCart);
