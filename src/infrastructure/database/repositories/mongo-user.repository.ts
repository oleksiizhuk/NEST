import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IUserRepository } from '@domain/user/user.repository.interface';
import { User } from '@domain/user/user.entity';
import { UserDocument } from '@infrastructure/database/schemas/user.schema';
import { UserMapper } from '@infrastructure/database/mappers/user.mapper';

@Injectable()
export class MongoUserRepository implements IUserRepository {
  constructor(@InjectModel('User') private userModel: Model<UserDocument>) {}

  async findAll(): Promise<User[]> {
    const docs = await this.userModel.find().limit(100).lean();
    return docs.map((doc) => UserMapper.toDomain(doc as UserDocument));
  }

  async findById(id: string): Promise<User | null> {
    const doc = await this.userModel.findById(id).lean();
    return doc ? UserMapper.toDomain(doc as UserDocument) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const doc = await this.userModel.findOne({ email }).lean();
    return doc ? UserMapper.toDomain(doc as UserDocument) : null;
  }

  async create(data: Omit<User, 'id' | 'toPublicProfile'>): Promise<User> {
    const doc = await this.userModel.create(data);
    return UserMapper.toDomain(doc);
  }

  async update(
    id: string,
    data: Partial<Omit<User, 'id' | 'toPublicProfile'>>,
  ): Promise<User> {
    const doc = await this.userModel.findByIdAndUpdate(id, data, { new: true });
    return UserMapper.toDomain(doc);
  }

  async delete(id: string): Promise<User> {
    const doc = await this.userModel.findByIdAndRemove(id);
    return UserMapper.toDomain(doc);
  }

  async updateShoppingCart(
    userId: string,
    cartId: string | null,
  ): Promise<User> {
    const doc = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { shoppingCartId: cartId } },
        { new: true },
      )
      .lean();
    return UserMapper.toDomain(doc as UserDocument);
  }
}
