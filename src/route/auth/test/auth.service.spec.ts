import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';
import { UserService } from '../../user/user.service';
import { JWTGenerator } from '../../../utils/JWTGenerator/JWTGenerator';
import { CreateAuthDto } from '../dto/create-auth.dto';

describe('AuthService', () => {
  let authService: AuthService;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;
  let jwtGenerator: jest.Mocked<JWTGenerator>;

  const mockUser = {
    _id: '123',
    firstName: 'John',
    lastName: 'Doe',
    age: 30,
    email: 'test@example.com',
    password: 'password123',
    shoppingCartId: 'cart-123',
  };

  const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  };

  beforeEach(async () => {
    const mockUserService = {
      getUserByEmail: jest.fn(),
      createUser: jest.fn(),
    };

    const mockJwtService = {
      decode: jest.fn(),
    };

    const mockJwtGenerator = {
      generateJWT: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: JWTGenerator, useValue: mockJwtGenerator },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    userService = module.get(UserService);
    jwtService = module.get(JwtService);
    jwtGenerator = module.get(JWTGenerator);
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });

  describe('isRegisteredUser', () => {
    it('should return true if user exists', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser);

      const result = await authService.isRegisteredUser({
        email: 'test@example.com',
      });

      expect(result).toBe(true);
      expect(userService.getUserByEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
    });

    it('should return false if user does not exist', async () => {
      userService.getUserByEmail.mockResolvedValue(null);

      const result = await authService.isRegisteredUser({
        email: 'nonexistent@example.com',
      });

      expect(result).toBe(false);
    });
  });

  describe('validateUser', () => {
    it('should return user if credentials are valid', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser);

      const result = await authService.validateUser({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toEqual(mockUser);
    });

    it('should throw BadRequestException if user not found', async () => {
      userService.getUserByEmail.mockResolvedValue(null);

      await expect(
        authService.validateUser({
          email: 'test@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if password is invalid', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.validateUser({
          email: 'test@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('singIn', () => {
    it('should return user with tokens on successful sign in', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser);
      jwtGenerator.generateJWT.mockReturnValue(mockTokens);

      const result = await authService.singIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toEqual({
        user: mockUser,
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
      });
    });
  });

  describe('registration', () => {
    it('should register new user and return tokens', async () => {
      userService.getUserByEmail.mockResolvedValue(null);
      userService.createUser.mockResolvedValue(mockUser);
      jwtGenerator.generateJWT.mockReturnValue(mockTokens);

      const result = await authService.registration({
        email: 'test@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        age: 30,
      } as CreateAuthDto);

      expect(result).toEqual({
        user: mockUser,
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
      });
    });

    it('should throw BadRequestException if email already exists', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.registration({
          email: 'test@example.com',
          password: 'password123',
          firstName: 'John',
          lastName: 'Doe',
          age: 30,
        } as CreateAuthDto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshToken', () => {
    it('should decode and return token payload', async () => {
      const decodedToken = { email: 'test@example.com', sub: '123' };
      jwtService.decode.mockReturnValue(decodedToken);

      const result = await authService.refreshToken('valid-token');

      expect(result).toEqual(decodedToken);
    });

    it('should throw BadRequestException for invalid token', async () => {
      jwtService.decode.mockReturnValue(null);

      await expect(authService.refreshToken('invalid-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('convertUserToPublicUser', () => {
    it('should return user without password', () => {
      const result = authService.convertUserToPublicUser(mockUser);

      expect(result).toEqual({
        _id: mockUser._id,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        age: mockUser.age,
        email: mockUser.email,
        shoppingCartId: mockUser.shoppingCartId,
      });
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('getPublicUserProfile', () => {
    it('should return public user profile', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser);

      const result = await authService.getPublicUserProfile('test@example.com');

      expect(result).toEqual({
        _id: mockUser._id,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        age: mockUser.age,
        email: mockUser.email,
        shoppingCartId: mockUser.shoppingCartId,
      });
    });
  });
});
