import {
  Controller,
  Post,
  Body,
  UseGuards,
  Headers,
  Get,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LoginHttpDto } from '@infrastructure/http/auth/dto/login.dto';
import { RegisterHttpDto } from '@infrastructure/http/auth/dto/register.dto';
import { JwtAuthGuard } from '@infrastructure/http/auth/guards/jwt-auth.guard';
import { CurrentUserEmail } from '@infrastructure/http/auth/auth-user.decorator';
import { LoginUseCase } from '@application/auth/use-cases/login.use-case';
import { RegisterUseCase } from '@application/auth/use-cases/register.use-case';
import { RefreshTokenUseCase } from '@application/auth/use-cases/refresh-token.use-case';
import { GetProfileUseCase } from '@application/auth/use-cases/get-profile.use-case';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly registerUseCase: RegisterUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly getProfileUseCase: GetProfileUseCase,
  ) {}

  @Post('login')
  logIn(@Body() dto: LoginHttpDto) {
    return this.loginUseCase.execute(dto);
  }

  @Post('registration')
  registration(
    @Body() { email, password, firstName, lastName, age }: RegisterHttpDto,
  ) {
    return this.registerUseCase.execute({
      email,
      password,
      firstName,
      lastName,
      age,
    });
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('profile')
  profile(@CurrentUserEmail() email: string) {
    return this.getProfileUseCase.execute(email);
  }

  // Send the refresh token as `Authorization: Bearer <refreshToken>`.
  @ApiBearerAuth()
  @Post('refresh-token')
  refreshToken(@Headers('authorization') authorization?: string) {
    const [scheme, token] = (authorization ?? '').split(' ');
    return this.refreshTokenUseCase.execute(
      scheme?.toLowerCase() === 'bearer' ? token : undefined,
    );
  }
}
