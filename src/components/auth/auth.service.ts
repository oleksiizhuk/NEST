import { BadRequestException, Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { UserDto } from '../user/dto/user.dto';
import { JwtService } from '@nestjs/jwt';
import SignInDto from './dto/signIn.dto';
import { IUser } from '../user/interfaces/user.interfaces';
import { CreateAuthDto } from './dto/create-auth.dto';

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

  async isRegisteredUser(user: SignInDto) {
    const { email } = user;
    const userFromDb = await this.userService.getUserByEmail(email);
    if (userFromDb) {
      throw new BadRequestException(
        `user with this email: ${email} is registration`,
      );
    }
  }
  async validateUserByEmailPassword(user: SignInDto) {
    const { email } = user;
    const userFromDb = await this.userService.getUserByEmail(email);
    console.log('userFromDb = ', userFromDb);
    if (!userFromDb) {
      throw new BadRequestException('invalid credential');
    }
    if (userFromDb.password !== user.password) {
      throw new BadRequestException('invalid credential');
    }
    return userFromDb;
  }

  async singIn(user: SignInDto) {
    const userFromDb = await this.validateUserByEmailPassword(user);
    console.log('userFromDb = ', userFromDb);
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

  async registration(user: CreateAuthDto): Promise<IUser> {
    await this.isRegisteredUser(user);
    console.log(123);
    return this.userService.createUser(user);
  }

  async getProfile(email: string): Promise<IUser> {
    return await this.userService.getUserByEmail(email);
  }
}
