import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from '@infrastructure/http/auth/auth.controller';
import { JwtStrategy } from '@infrastructure/http/auth/strategies/jwt.strategy';
import { LocalStrategy } from '@infrastructure/http/auth/strategies/local.strategy';
import { jwtConstants } from '@infrastructure/http/auth/constants/constants';
import { JWTGenerator } from '@infrastructure/http/auth/utils/jwt-generator';
import { UserModule } from '@infrastructure/http/user/user.module';
import { LoginUseCase } from '@application/auth/use-cases/login.use-case';
import { RegisterUseCase } from '@application/auth/use-cases/register.use-case';
import { RefreshTokenUseCase } from '@application/auth/use-cases/refresh-token.use-case';
import { GetProfileUseCase } from '@application/auth/use-cases/get-profile.use-case';

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
