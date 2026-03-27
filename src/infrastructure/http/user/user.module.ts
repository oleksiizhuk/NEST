import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { UserController } from './user.controller';
import { UserSchema } from '../../database/schemas/user.schema';
import { MongoUserRepository } from '../../database/repositories/mongo-user.repository';
import { USER_REPOSITORY } from '../../../domain/user/user.repository.interface';
import { GetUsersUseCase } from '../../../application/user/use-cases/get-users.use-case';
import { CreateUserUseCase } from '../../../application/user/use-cases/create-user.use-case';
import { GetUserByIdUseCase } from '../../../application/user/use-cases/get-user-by-id.use-case';
import { GetUserByEmailUseCase } from '../../../application/user/use-cases/get-user-by-email.use-case';
import { UpdateUserUseCase } from '../../../application/user/use-cases/update-user.use-case';
import { DeleteUserUseCase } from '../../../application/user/use-cases/delete-user.use-case';
import { UpdateUserShoppingCartUseCase } from '../../../application/user/use-cases/update-user-shopping-cart.use-case';

const userUseCases = [
  GetUsersUseCase,
  CreateUserUseCase,
  GetUserByIdUseCase,
  GetUserByEmailUseCase,
  UpdateUserUseCase,
  DeleteUserUseCase,
  UpdateUserShoppingCartUseCase,
];

@Module({
  imports: [
    PassportModule,
    MongooseModule.forFeature([{ name: 'User', schema: UserSchema }]),
  ],
  controllers: [UserController],
  providers: [
    { provide: USER_REPOSITORY, useClass: MongoUserRepository },
    ...userUseCases,
  ],
  exports: [USER_REPOSITORY, ...userUseCases],
})
export class UserModule {}
