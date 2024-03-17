import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { Document, Types } from 'mongoose';
import { Product } from '../../product/schema/product.schema';

class Price {
  @Prop({ required: true })
  count: number;
}

@Schema({ timestamps: true })
export class ShoppingCart extends Document {
  @Prop({ required: true })
  id: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }] })
  @Type(() => Product)
  items: Product[];

  @Prop({ type: Price })
  price: Price;
}

export const ShoppingCartSchema = SchemaFactory.createForClass(ShoppingCart);
