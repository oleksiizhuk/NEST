import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { jwtConstants } from '../../../route/auth/constants/constants';
import { JWTGenerator } from '../../../utils/JWTGenerator/JWTGenerator';
import { UserModule } from '../user/user.module';
import { LoginUseCase } from '../../../application/auth/use-cases/login.use-case';
import { RegisterUseCase } from '../../../application/auth/use-cases/register.use-case';
import { RefreshTokenUseCase } from '../../../application/auth/use-cases/refresh-token.use-case';
import { GetProfileUseCase } from '../../../application/auth/use-cases/get-profile.use-case';

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
  providers: [
    JWTGenerator,
    JwtStrategy,
    LocalStrategy,
    LoginUseCase,
    RegisterUseCase,
    RefreshTokenUseCase,
    GetProfileUseCase,
  ],
  exports: [LoginUseCase],
})
export class AuthModule {}
