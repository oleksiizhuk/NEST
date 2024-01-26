import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { IUser } from '../../route/user/interfaces/user.interfaces';
import { AuthService } from '../../route/auth/auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({ usernameField: 'email', passwordField: 'password' });
  }

  async validate(email: string, password: string): Promise<IUser> {
    return await this.authService.validateUser({
      email,
      password,
    });
  }
}
