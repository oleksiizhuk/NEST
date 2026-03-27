import {
  Controller,
  Post,
  Body,
  UseGuards,
  Headers,
  Get,
  Request,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LoginHttpDto } from './dto/login.dto';
import { RegisterHttpDto } from './dto/register.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginUseCase } from '../../../application/auth/use-cases/login.use-case';
import { RegisterUseCase } from '../../../application/auth/use-cases/register.use-case';
import { RefreshTokenUseCase } from '../../../application/auth/use-cases/refresh-token.use-case';
import { GetProfileUseCase } from '../../../application/auth/use-cases/get-profile.use-case';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly registerUseCase: RegisterUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly getProfileUseCase: GetProfileUseCase,
  ) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  logIn(@Body() dto: LoginHttpDto) {
    return this.loginUseCase.execute(dto);
  }

  @Post('registration')
  async registration(@Body() dto: RegisterHttpDto) {
    return this.registerUseCase.execute(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Request() req) {
    return this.getProfileUseCase.execute(req.user.email.email);
  }

  @Post('refresh-token')
  refreshToken(@Headers() headers: any) {
    const { authorization } = headers;
    return this.refreshTokenUseCase.execute(authorization.split(' ')[1]);
  }
}
