import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ShoppingCartSchema } from './schema/shoppingCart.schema';
import { ShoppingCartController } from './shoppingCart.controller';
import { ShoppingCartService } from './shoppingCart.service';
import { ShoppingCartRepository } from './shoppingCart.repository';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: 'ShoppingCart', schema: ShoppingCartSchema },
    ]),
  ],
  controllers: [ShoppingCartController],
  providers: [ShoppingCartService, ShoppingCartRepository],
  exports: [ShoppingCartService],
})
export class ShoppingCartModule {}
