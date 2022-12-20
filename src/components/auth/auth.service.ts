import { BadRequestException, Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { UserDto } from '../user/dto/user.dto';
import { JwtService } from '@nestjs/jwt';
import SignInDto from './dto/signIn.dto';
import { IUser } from '../user/interfaces/user.interfaces';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private jwtService: JwtService,
  ) {}

  private decodeJWT(token: string) {
    const result = this.jwtService.decode(token);
    if (!result) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Token is invalid',
      });
    }
    return result;
  }

  async refreshToken(token: string) {
    return this.decodeJWT(token);
  }

  async validateUserByEmailPassword(user: SignInDto) {
    const { email } = user;
    console.log('email = ', email);
    const userFromDb = await this.userService.getUserByEmail(email);
    if (!userFromDb) {
      throw new BadRequestException('invalid credential lol');
    }
    if (userFromDb.password !== user.password) {
      throw new BadRequestException('invalid credential lol');
    }
    return userFromDb;
  }

  async singIn(user: SignInDto) {
    const userFromDb = await this.validateUserByEmailPassword(user);
    const payload = { email: userFromDb.email };
    return {
      user: userFromDb,
      accessToken: this.jwtService.sign(payload, {
        secret: 'secret',
        expiresIn: '24h',
      }),
      refreshToken: this.jwtService.sign(payload, {
        secret: 'secret',
        expiresIn: '100h',
      }),
    };
  }

  async signUp(user: UserDto): Promise<IUser> {
    return user;
  }

  async registration(user: UserDto): Promise<IUser> {
    return user;
  }

  async getProfile(email: string): Promise<IUser> {
    return await this.userService.getUserByEmail(email);
  }
}
