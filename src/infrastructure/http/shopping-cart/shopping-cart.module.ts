import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShoppingCartController } from './shopping-cart.controller';
import { ShoppingCartSchema } from '../../database/schemas/shopping-cart.schema';
import { MongoShoppingCartRepository } from '../../database/repositories/mongo-shopping-cart.repository';
import { SHOPPING_CART_REPOSITORY } from '../../../domain/shopping-cart/shopping-cart.repository.interface';
import { UserModule } from '../user/user.module';
import { ProductModule } from '../product/product.module';
import { CreateShoppingCartUseCase } from '../../../application/shopping-cart/use-cases/create-shopping-cart.use-case';
import { AddItemUseCase } from '../../../application/shopping-cart/use-cases/add-item.use-case';
import { GetCartUseCase } from '../../../application/shopping-cart/use-cases/get-cart.use-case';
import { CompleteOrderUseCase } from '../../../application/shopping-cart/use-cases/complete-order.use-case';

@Module({
  imports: [
    UserModule,
    ProductModule,
    MongooseModule.forFeature([{ name: 'ShoppingCart', schema: ShoppingCartSchema }]),
  ],
  controllers: [ShoppingCartController],
  providers: [
    { provide: SHOPPING_CART_REPOSITORY, useClass: MongoShoppingCartRepository },
    CreateShoppingCartUseCase,
    AddItemUseCase,
    GetCartUseCase,
    CompleteOrderUseCase,
  ],
})
export class ShoppingCartModule {}