import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class RefreshTokenUseCase {
  constructor(private readonly jwtService: JwtService) {}

  execute(token: string): unknown {
    const result = this.jwtService.decode(token);
    if (!result) {
      throw new BadRequestException({ statusCode: 400, message: 'Token is invalid' });
    }
    return result;
  }
}