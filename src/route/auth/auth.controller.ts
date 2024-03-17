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
import { AuthService } from './auth.service';
import { LoginDTO } from './dto/Login.dto';
import { CreateAuthDto } from './dto/create-auth.dto';
import { LocalAuthGuard } from '../../guards/guards/local-auth.guard';
import { JwtAuthGuard } from '../../guards/guards/jwt-auth.guard';
import { LogMethodCallAndReturn } from '../../decorator/logMethodCallAndReturn';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  logIn(@Body() user: LoginDTO) {
    return this.authService.singIn(user);
  }

  @Post('registration')
  @LogMethodCallAndReturn('AuthController')
  async registration(@Body() user: CreateAuthDto) {
    return await this.authService.registration(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Request() req) {
    return this.authService.getPublicUserProfile(req.user.email.email);
  }

  @Post('refresh-token')
  refreshToken(@Headers() headers: any) {
    const { authorization } = headers;
    return this.authService.refreshToken(authorization.split(' ')[1]);
  }
}
