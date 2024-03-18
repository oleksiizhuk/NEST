import { Document } from 'mongoose';

export class UserEntity extends Document {
  readonly firstName: string;
  readonly lastName: string;
  readonly age: number;
  readonly email: string;
  readonly password: string;
  readonly shoppingCartId: string;
}
