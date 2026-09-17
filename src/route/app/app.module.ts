import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

import { UserModule } from '@infrastructure/http/user/user.module';
import { AuthModule } from '@infrastructure/http/auth/auth.module';
import { ProductModule } from '@infrastructure/http/product/product.module';
import { ShoppingCartModule } from '@infrastructure/http/shopping-cart/shopping-cart.module';
import { EmailHttpModule } from '@infrastructure/http/email/email.module';
import { TelegramHttpModule } from '@infrastructure/http/telegram/telegram.module';
import { McpHttpModule } from '@infrastructure/http/mcp/mcp.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    EmailHttpModule,
    ProductModule,
    ShoppingCartModule,
    TelegramHttpModule,
    McpHttpModule,
    ConfigModule.forRoot(),
    MongooseModule.forRootAsync({
      useFactory: () => {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
          throw new Error(
            'MONGODB_URI is not set. Configure it in the environment ' +
              '(and in Vercel) before starting the app.',
          );
        }
        return { uri, autoCreate: true };
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
