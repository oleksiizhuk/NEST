import { jwtConstants } from '../../route/auth/constants/constants';
import { JwtService } from '@nestjs/jwt';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JWTGenerator {
  constructor(private jwtService: JwtService) {}
  public generateJWT(email: string) {
    const payload = { email: email };
    return {
      accessToken: this.jwtService.sign(payload, {
        secret: jwtConstants.secret,
        expiresIn: '24h',
      }),
      refreshToken: this.jwtService.sign(payload, {
        secret: jwtConstants.secret,
        expiresIn: '100h',
      }),
    };
  }
}
