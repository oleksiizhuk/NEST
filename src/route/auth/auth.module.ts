import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module';
import { LocalStrategy } from '../../service/strategy/local.strategy';
import { JwtStrategy } from '../../service/strategy/jwt.strategy';
import { jwtConstants } from './constants/constants';
import { JWTGenerator } from '../../utils/JWTGenerator/JWTGenerator';

@Module({
  imports: [
    UserModule,
    PassportModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, JWTGenerator],
  exports: [AuthService],
})
export class AuthModule {}
