import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JWTGenerator {
  constructor(private readonly jwtService: JwtService) {}

  generateJWT(email: string): { accessToken: string; refreshToken: string } {
    const accessToken = this.jwtService.sign({ email }, { expiresIn: '24h' });
    const refreshToken = this.jwtService.sign({ email }, { expiresIn: '100h' });
    return { accessToken, refreshToken };
  }
}
