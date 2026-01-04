import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ShoppingCartService } from '../shoppingCart.service';
import { ShoppingCartRepository } from '../shoppingCart.repository';
import { UserService } from '../../user/user.service';
import { ProductService } from '../../product/product.service';
import { ShoppingCartEntity } from '../entity/shoppingCart.entity';
import { ProductEntity } from '../../product/entity/product.entity';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

describe('ShoppingCartService', () => {
  let shoppingCartService: ShoppingCartService;
  let shoppingCartRepository: jest.Mocked<ShoppingCartRepository>;
  let userService: jest.Mocked<UserService>;
  let productService: jest.Mocked<ProductService>;

  const mockUser = {
    _id: 'user-123',
    firstName: 'John',
    lastName: 'Doe',
    age: 30,
    email: 'test@example.com',
    password: 'password123',
    shoppingCartId: 'cart-123',
  };

  const mockProduct = {
    id: 'product-1',
    name: 'Test Product',
    price: 100,
    age: 0,
    type: 'phone',
    imageUrl: 'test.jpg',
    snippet: 'Test snippet',
    discount: 0,
    screen: '6.1 inches',
    capacity: '128GB',
    ram: '8GB',
  } as unknown as ProductEntity;

  const mockCart = {
    id: 'cart-123',
    items: [{ count: 2, item: mockProduct }],
    price: { price: 200, discount: 0, finalPrice: 200 },
  } as unknown as ShoppingCartEntity;

  const mockEmptyCart = {
    id: 'cart-123',
    items: [],
    price: { price: 0, discount: 0, finalPrice: 0 },
  } as unknown as ShoppingCartEntity;

  beforeEach(async () => {
    const mockShoppingCartRepository = {
      addItem: jest.fn(),
      getCart: jest.fn(),
      createShoppingCart: jest.fn(),
    };

    const mockUserService = {
      getUserByEmail: jest.fn(),
      addShoppingShoppingCartToUser: jest.fn(),
    };

    const mockProductService = {
      getByID: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShoppingCartService,
        {
          provide: ShoppingCartRepository,
          useValue: mockShoppingCartRepository,
        },
        { provide: UserService, useValue: mockUserService },
        { provide: ProductService, useValue: mockProductService },
      ],
    }).compile();

    shoppingCartService = module.get<ShoppingCartService>(ShoppingCartService);
    shoppingCartRepository = module.get(ShoppingCartRepository);
    userService = module.get(UserService);
    productService = module.get(ProductService);
  });

  it('should be defined', () => {
    expect(shoppingCartService).toBeDefined();
  });

  describe('addItem', () => {
    it('should add item to shopping cart', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser as any);
      productService.getByID.mockResolvedValue(mockProduct);
      shoppingCartRepository.addItem.mockResolvedValue(mockCart);

      const result = await shoppingCartService.addItem(
        'test@example.com',
        'product-1',
        2,
      );

      expect(result).toEqual(mockCart);
      expect(shoppingCartRepository.addItem).toHaveBeenCalledWith(
        'cart-123',
        mockProduct,
        2,
      );
    });

    it('should throw BadRequestException if shoppingCartId is null', async () => {
      userService.getUserByEmail.mockResolvedValue({
        ...mockUser,
        shoppingCartId: null,
      } as any);

      await expect(
        shoppingCartService.addItem('test@example.com', 'product-1', 2),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if product does not exist', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser as any);
      productService.getByID.mockResolvedValue(null as any);

      await expect(
        shoppingCartService.addItem('test@example.com', 'nonexistent', 2),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCart', () => {
    it('should return shopping cart', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser as any);
      shoppingCartRepository.getCart.mockResolvedValue(mockCart);

      const result = await shoppingCartService.getCart('test@example.com');

      expect(result).toEqual(mockCart);
      expect(shoppingCartRepository.getCart).toHaveBeenCalledWith('cart-123');
    });

    it('should throw BadRequestException if shoppingCartId is null', async () => {
      userService.getUserByEmail.mockResolvedValue({
        ...mockUser,
        shoppingCartId: null,
      } as any);

      await expect(
        shoppingCartService.getCart('test@example.com'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('shoppingCartIsEmpty', () => {
    it('should return true if cart has no items', async () => {
      shoppingCartRepository.getCart.mockResolvedValue(mockEmptyCart);

      const result = await shoppingCartService.shoppingCartIsEmpty('cart-123');

      expect(result).toBe(true);
    });

    it('should return false if cart has items', async () => {
      shoppingCartRepository.getCart.mockResolvedValue(mockCart);

      const result = await shoppingCartService.shoppingCartIsEmpty('cart-123');

      expect(result).toBe(false);
    });
  });

  describe('completeOrder', () => {
    it('should complete order successfully', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser as any);
      shoppingCartRepository.getCart.mockResolvedValue(mockCart);

      await shoppingCartService.completeOrder('test@example.com');

      expect(userService.addShoppingShoppingCartToUser).toHaveBeenCalledWith(
        'user-123',
        null,
      );
    });

    it('should throw BadRequestException if shoppingCartId is null', async () => {
      userService.getUserByEmail.mockResolvedValue({
        ...mockUser,
        shoppingCartId: null,
      } as any);

      await expect(
        shoppingCartService.completeOrder('test@example.com'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if cart is empty', async () => {
      userService.getUserByEmail.mockResolvedValue(mockUser as any);
      shoppingCartRepository.getCart.mockResolvedValue(mockEmptyCart);

      await expect(
        shoppingCartService.completeOrder('test@example.com'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createShoppingCart', () => {
    it('should create a new shopping cart', async () => {
      const newCart = {
        id: 'mock-uuid',
        items: [],
        price: { price: 0, discount: 0, finalPrice: 0 },
      } as unknown as ShoppingCartEntity;
      userService.getUserByEmail.mockResolvedValue(mockUser as any);
      shoppingCartRepository.createShoppingCart.mockResolvedValue(newCart);

      const result = await shoppingCartService.createShoppingCart(
        'test@example.com',
      );

      expect(result).toEqual(newCart);
      expect(shoppingCartRepository.createShoppingCart).toHaveBeenCalledWith(
        'mock-uuid',
      );
      expect(userService.addShoppingShoppingCartToUser).toHaveBeenCalledWith(
        'user-123',
        'mock-uuid',
      );
    });
  });
});
