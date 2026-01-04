import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from '../user.service';
import { UserRepository } from '../user.repository';
import { IUser } from '../interfaces/user.interfaces';

describe('UserService', () => {
  let service: UserService;
  let userRepository: jest.Mocked<UserRepository>;

  const mockUser: IUser = {
    _id: '123',
    firstName: 'John',
    lastName: 'Doe',
    age: 30,
    email: 'test@example.com',
    password: 'password123',
    shoppingCartId: 'cart-123',
  };

  beforeEach(async () => {
    const mockUserRepository = {
      getUsers: jest.fn(),
      createUser: jest.fn(),
      getUserById: jest.fn(),
      getUserByEmail: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      addShoppingShoppingCartToUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: UserRepository, useValue: mockUserRepository },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(UserRepository);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUsers', () => {
    it('should return all users', async () => {
      userRepository.getUsers.mockResolvedValue([mockUser]);

      const result = await service.getUsers();

      expect(result).toEqual([mockUser]);
    });
  });

  describe('createUser', () => {
    it('should create a new user', async () => {
      const newUser = {
        firstName: 'Jane',
        lastName: 'Doe',
        age: 25,
        email: 'jane@example.com',
        password: 'password456',
      };
      userRepository.createUser.mockResolvedValue({
        ...newUser,
        _id: '456',
      } as IUser);

      const result = await service.createUser(newUser);

      expect(result._id).toBe('456');
      expect(userRepository.createUser).toHaveBeenCalledWith(newUser);
    });
  });

  describe('getUserById', () => {
    it('should return user by id', async () => {
      userRepository.getUserById.mockResolvedValue(mockUser);

      const result = await service.getUserById('123');

      expect(result).toEqual(mockUser);
      expect(userRepository.getUserById).toHaveBeenCalledWith('123');
    });
  });

  describe('getUserByEmail', () => {
    it('should return user by email (lowercase)', async () => {
      userRepository.getUserByEmail.mockResolvedValue(mockUser);

      const result = await service.getUserByEmail('TEST@EXAMPLE.COM');

      expect(result).toEqual(mockUser);
      expect(userRepository.getUserByEmail).toHaveBeenCalledWith(
        'test@example.com',
      );
    });
  });

  describe('update', () => {
    it('should update user', async () => {
      const updatedUser = { ...mockUser, firstName: 'Updated' };
      userRepository.update.mockResolvedValue(updatedUser);

      const result = await service.update('123', {
        firstName: 'Updated',
      } as any);

      expect(result.firstName).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('should delete user', async () => {
      userRepository.delete.mockResolvedValue(mockUser);

      const result = await service.delete('123');

      expect(result).toEqual(mockUser);
      expect(userRepository.delete).toHaveBeenCalledWith('123');
    });
  });

  describe('addShoppingShoppingCartToUser', () => {
    it('should add shopping cart to user', async () => {
      const updatedUser = { ...mockUser, shoppingCartId: 'new-cart-id' };
      userRepository.addShoppingShoppingCartToUser.mockResolvedValue(
        updatedUser,
      );

      const result = await service.addShoppingShoppingCartToUser(
        '123',
        'new-cart-id',
      );

      expect(result.shoppingCartId).toBe('new-cart-id');
    });
  });
});
