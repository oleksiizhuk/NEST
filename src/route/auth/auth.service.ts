import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { LoginDTO } from './dto/Login.dto';
import { IUser } from '../user/interfaces/user.interfaces';
import { CreateAuthDto } from './dto/create-auth.dto';
import { JWTGenerator } from '../../utils/JWTGenerator/JWTGenerator';
import { LogMethodCallAndReturn } from '../../decorator/logMethodCallAndReturn';

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

  @LogMethodCallAndReturn('AuthService')
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

  @LogMethodCallAndReturn('AuthService')
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

  async getPublicUserProfile(email: string): Promise<Omit<IUser, 'password'>> {
    const user = await this.userService.getUserByEmail(email);
    return this.convertUserToPublicUser(user);
  }

  convertUserToPublicUser(user: IUser): Omit<IUser, 'password'> {
    return {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      age: user.age,
      email: user.email,
      shoppingCartId: user.shoppingCartId,
    };
  }
}
