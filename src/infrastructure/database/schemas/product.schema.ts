import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class ProductDocument extends Document {
  @Prop({ required: true })
  age: number;

  // Legacy field kept for existing documents; new products mirror _id here.
  @Prop()
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

export const ProductSchema = SchemaFactory.createForClass(ProductDocument);
