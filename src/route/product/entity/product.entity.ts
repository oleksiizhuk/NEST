import { Document } from 'mongoose';

export class ProductEntity extends Document {
  readonly age: number;
  readonly id: string;
  readonly type: string;
  readonly imageUrl: string;
  readonly name: string;
  readonly snippet: string;
  readonly price: number;
  readonly discount: number;
  readonly screen: string;
  readonly capacity: string;
  readonly ram: string;
}

// "age": 0,
//   "id": "motorola-xoom-with-wi-fi",
//   "type": "tablet",
//   "imageUrl": "img/phones/motorola-xoom-with-wi-fi.0.jpg",
//   "name": "Motorola XOOM™ with Wi-Fi",
//   "snippet": "The Next, Next Generation\r\n\r\nExperience the future with Motorola XOOM with Wi-Fi, the world's first tablet powered by Android 3.0 (Honeycomb).",
//   "price": 780,
//   "discount": 0,
//   "screen": "10.1 inches",
//   "capacity": "32000MB",
//   "ram": "1000MB"
