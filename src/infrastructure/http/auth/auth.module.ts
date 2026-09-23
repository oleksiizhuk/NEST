import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from '@infrastructure/http/auth/auth.controller';
import { JwtStrategy } from '@infrastructure/http/auth/strategies/jwt.strategy';
import { getJwtSecret } from '@infrastructure/http/auth/constants/constants';
import { JwtTokenService } from '@infrastructure/http/auth/utils/jwt-token.service';
import { UserModule } from '@infrastructure/http/user/user.module';
import { TOKEN_SERVICE } from '@application/auth/token-service.interface';
import { LoginUseCase } from '@application/auth/use-cases/login.use-case';
import { RegisterUseCase } from '@application/auth/use-cases/register.use-case';
import { RefreshTokenUseCase } from '@application/auth/use-cases/refresh-token.use-case';
import { GetProfileUseCase } from '@application/auth/use-cases/get-profile.use-case';

@Module({
  imports: [
    UserModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: getJwtSecret() }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    { provide: TOKEN_SERVICE, useClass: JwtTokenService },
    JwtStrategy,
    LoginUseCase,
    RegisterUseCase,
    RefreshTokenUseCase,
    GetProfileUseCase,
  ],
  exports: [LoginUseCase],
})
export class AuthModule {}
