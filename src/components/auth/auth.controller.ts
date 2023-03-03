import {
  Controller,
  Post,
  Body,
  UseGuards,
  Headers,
  Get,
  Request,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserDto } from '../user/dto/user.dto';
import { AuthGuard } from '@nestjs/passport';
import SignInDto from './dto/signIn.dto';
import { CreateAuthDto } from './dto/create-auth.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('/refresh-token')
  refreshToke(@Headers() headers: any) {
    const { authorization } = headers;
    return this.authService.refreshToken(authorization.split(' ')[1]);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @Get('profile')
  getProfile(@Request() req) {
    return this.authService.getProfile(req.user.email.email);
  }

  // @UseGuards(AuthGuard('local'))
  @Post('/sign-in')
  signIn(@Body() user: SignInDto) {
    console.log('user = ', user)
    return this.authService.singIn(user);
  }

  // @UseGuards(AuthGuard('local'))
  // @UseGuards(AuthGuard('local'))
  @Post('/sign-up')
  signUp(@Body() user: UserDto) {
    console.log('user = ', user);
    return this.authService.signUp(user);
  }

  // @UseGuards(AuthGuard('local'))
  @Post('/registration')
  registration(@Body() user: CreateAuthDto) {
    console.log('user = ', user);
    return this.authService.registration(user);
  }
}
