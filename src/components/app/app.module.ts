import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from '../user/user.module';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    UserModule,
    ConfigModule.forRoot(),
    MongooseModule.forRoot(
      // "mongodb+srv://oleksii:223132qq@cluster0.bzoaa.mongodb.net/myFirstDatabase?retryWrites=true&w=majority",
      'mongodb+srv://oleksii:223132qq@cluster0.bzoaa.mongodb.net/?retryWrites=true&w=majority',
      { autoCreate: true },
    ),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
