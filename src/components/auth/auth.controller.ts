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
import { LocalAuthGuard } from '../../service/guards/local-auth.guard';
import { JwtAuthGuard } from '../../service/guards/jwt-auth.guard';

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
  registration(@Body() user: CreateAuthDto) {
    return this.authService.registration(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Request() req) {
    console.log(req.user);
    return this.authService.getProfile(req.user.email.email);
  }

  @Post('refresh-token')
  refreshToken(@Headers() headers: any) {
    const { authorization } = headers;
    return this.authService.refreshToken(authorization.split(' ')[1]);
  }
}
