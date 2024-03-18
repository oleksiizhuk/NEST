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

const ShoppingCart = {
  id: '',
  items: [
    {
      count: 0,
      items: {
        age: 0,
        id: 'motorola-xoom-with-wi-fi',
        type: 'tablet',
        imageUrl: 'img/phones/motorola-xoom-with-wi-fi.0.jpg',
        name: 'Motorola XOOM™ with Wi-Fi',
        snippet:
          "The Next, Next Generation\r\n\r\nExperience the future with Motorola XOOM with Wi-Fi, the world's first tablet powered by Android 3.0 (Honeycomb).",
        price: 780,
        discount: 0,
        screen: '10.1 inches',
        capacity: '32000MB',
        ram: '1000MB',
      },
    },
  ],
  price: {
    price: 780,
    discount: 0,
    finalPrice: 780,
  },
};
