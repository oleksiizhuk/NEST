import { BadRequestException, Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { UserDto } from '../user/dto/user.dto';
import { JwtService } from '@nestjs/jwt';
import { LoginDTO } from './dto/Login.dto';
import { IUser } from '../user/interfaces/user.interfaces';
import { CreateAuthDto } from './dto/create-auth.dto';
import { JWTGenerator } from '../../utils/JWTGenerator/JWTGenerator';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private jwtService: JwtService,
    private readonly jwtGenerator: JWTGenerator,
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
    const { accessToken, refreshToken } = this.jwtGenerator.generateJWT(
      userFromDb.email,
    );
    return {
      user: userFromDb,
      accessToken,
      refreshToken,
    };
  }

  async signUp(user: UserDto): Promise<IUser> {
    return user;
  }

  async registration(newUser: CreateAuthDto) {
    await this.isRegisteredUser(newUser);
    const user = await this.userService.createUser(newUser);
    const { accessToken, refreshToken } = this.jwtGenerator.generateJWT(
      user.email,
    );
    return {
      user,
      accessToken,
      refreshToken,
    };
  }

  async getProfile(email: string): Promise<IUser> {
    return await this.userService.getUserByEmail(email);
  }
}
