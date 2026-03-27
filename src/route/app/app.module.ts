import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

// Clean Architecture modules
import { UserModule } from '../../infrastructure/http/user/user.module';
import { AuthModule } from '../../infrastructure/http/auth/auth.module';
import { ProductModule } from '../../infrastructure/http/product/product.module';
import { ShoppingCartModule } from '../../infrastructure/http/shopping-cart/shopping-cart.module';

// Keep EmailModule from old structure (not yet migrated)
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    EmailModule,
    ProductModule,
    ShoppingCartModule,
    ConfigModule.forRoot(),
    MongooseModule.forRoot(
      process.env.MONGODB_URI ||
        'mongodb+srv://oleksii:223132qq@cluster0.bzoaa.mongodb.net/?retryWrites=true&w=majority',
      { autoCreate: true },
    ),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
