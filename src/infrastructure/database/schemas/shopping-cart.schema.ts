import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Type } from 'class-transformer';
import { ProductDocument } from './product.schema';

class PriceDocument {
  @Prop({ required: true, default: 0 })
  price: number;

  @Prop({ required: true, default: 0 })
  discount: number;

  @Prop({ required: true, default: 0 })
  finalPrice: number;
}

@Schema({ timestamps: true })
export class ShoppingCartDocument extends Document {
  @Prop({ required: true })
  id: string;

  @Prop({
    type: [
      {
        count: { type: Number, required: true },
        item: { type: Types.ObjectId, ref: 'Product', required: true },
      },
    ],
    default: [],
  })
  @Type(() => ProductDocument)
  items: Array<{ count: number; item: ProductDocument }>;

  @Prop({
    type: PriceDocument,
    required: true,
    default: () => ({ price: 0, discount: 0, finalPrice: 0 }),
  })
  price: PriceDocument;
}

export const ShoppingCartSchema =
  SchemaFactory.createForClass(ShoppingCartDocument);
