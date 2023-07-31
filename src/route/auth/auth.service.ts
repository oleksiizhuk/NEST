import { BadRequestException, Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { UserDto } from '../user/dto/user.dto';
import { JwtService } from '@nestjs/jwt';
import { LoginDTO } from './dto/Login.dto';
import { IUser } from '../user/interfaces/user.interfaces';
import { CreateAuthDto } from './dto/create-auth.dto';
import { jwtConstants } from './constants/constants';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private jwtService: JwtService,
  ) {}

  private decodeJWT(token: string) {
    const result = this.jwtService.decode(token);
    console.log('decodeJWT = ', 123);
    if (!result) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Token is invalid',
      });
    }
    return result;
  }

  async refreshToken(token: string) {
    console.log('refreshToken = ', 123);
    return this.decodeJWT(token);
  }

  async isRegisteredUser(user: LoginDTO) {
    const { email } = user;
    const userFromDb = await this.userService.getUserByEmail(email);
    if (userFromDb) {
      throw new BadRequestException(`This email ${email} is already exists`);
    }
  }
  async validateUser(user: LoginDTO): Promise<IUser> {
    const { email } = user;
    const userFromDb = await this.userService.getUserByEmail(email);
    if (!userFromDb || userFromDb.password !== user.password) {
      throw new BadRequestException('invalid credential');
    }
    return userFromDb;
  }

  async singIn(user: LoginDTO) {
    const userFromDb = await this.validateUser(user);
    const payload = { email: userFromDb.email };
    return {
      user: userFromDb,
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

  async signUp(user: UserDto): Promise<IUser> {
    return user;
  }

  async registration(newUser: CreateAuthDto) {
    await this.isRegisteredUser(newUser);
    const user = await this.userService.createUser(newUser);
    const payload = { email: user.email };
    return {
      user,
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

  async getProfile(email: string): Promise<IUser> {
    return await this.userService.getUserByEmail(email);
  }
}
