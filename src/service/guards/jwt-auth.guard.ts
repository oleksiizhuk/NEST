import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export default class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err, user) {
    // Если возникла ошибка "Unknown authentication strategy 'jwt'",
    // выбросьте UnauthorizedException и обработайте ее в вашем обработчике исключений
    if (err || !user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
