import { Document } from 'mongoose';

export class UserEntity extends Document {
  readonly name: string;
  readonly email: string;
  readonly password: string;
}
