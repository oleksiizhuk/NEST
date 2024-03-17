import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
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

  async isRegisteredUser({
    email,
  }: {
    email: LoginDTO['email'];
  }): Promise<boolean> {
    const user = await this.userService.getUserByEmail(email);
    return !!user;
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

  async registration(newUser: CreateAuthDto) {
    const isRegisteredUser = await this.isRegisteredUser(newUser);
    if (isRegisteredUser) {
      throw new BadRequestException(
        `This email ${newUser.email} is already exists`,
      );
    }

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
