import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from '../user/user.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ProductModule } from '../product/product.module';
import { BinanceModule } from '../binance/binance.module';
import { ShoppingCartModule } from '../shoppingCart/shoppingCart.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    EmailModule,
    ProductModule,
    ShoppingCartModule,
    BinanceModule,
    ConfigModule.forRoot(),
    MongooseModule.forRoot(
      'mongodb+srv://oleksii:223132qq@cluster0.bzoaa.mongodb.net/?retryWrites=true&w=majority',
      { autoCreate: true },
    ),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'swagger-static'),
      serveRoot: process.env.NODE_ENV === 'staging' ? '/' : '/swagger',
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
