import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true })
  age: number;

  @Prop({ required: true })
  id: string;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  snippet: string;

  @Prop({ required: true })
  price: number;

  @Prop({ required: true })
  discount: number;

  @Prop({ required: true })
  screen: string;

  @Prop({ required: true })
  capacity: string;

  @Prop({ required: true })
  ram: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
