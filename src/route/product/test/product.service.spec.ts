import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from '../product.service';
import { ProductRepository } from '../product.repository';
import { ProductEntity } from '../entity/product.entity';
import { IPaginationProduct } from '../product.types';

describe('ProductService', () => {
  let productService: ProductService;
  let productRepository: jest.Mocked<ProductRepository>;

  const mockProduct = {
    id: '1',
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

  const mockPaginatedResult: IPaginationProduct = {
    items: [mockProduct],
    totalItems: 1,
    itemCount: 1,
    itemsPerPage: 10,
    totalPages: 1,
    currentPage: 1,
  };

  beforeEach(async () => {
    const mockProductRepository = {
      getProduct: jest.fn(),
      getByID: jest.fn(),
      addProduct: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: ProductRepository, useValue: mockProductRepository },
      ],
    }).compile();

    productService = module.get<ProductService>(ProductService);
    productRepository = module.get(ProductRepository);
  });

  it('should be defined', () => {
    expect(productService).toBeDefined();
  });

  describe('getProduct', () => {
    it('should return paginated products', async () => {
      productRepository.getProduct.mockResolvedValue(mockPaginatedResult);

      const result = await productService.getProduct({ page: 1, limit: 10 });

      expect(result).toEqual(mockPaginatedResult);
      expect(productRepository.getProduct).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });
  });

  describe('getByID', () => {
    it('should return a product by ID', async () => {
      productRepository.getByID.mockResolvedValue(mockProduct);

      const result = await productService.getByID('1');

      expect(result).toEqual(mockProduct);
      expect(productRepository.getByID).toHaveBeenCalledWith('1');
    });

    it('should return null if product not found', async () => {
      productRepository.getByID.mockResolvedValue(null as any);

      const result = await productService.getByID('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('addProduct', () => {
    it('should add a new product', async () => {
      const newProduct = {
        name: 'New Product',
        price: 200,
        age: 0,
        type: 'tablet',
        imageUrl: 'new.jpg',
        snippet: 'New snippet',
        discount: 10,
        screen: '10 inches',
        capacity: '256GB',
        ram: '16GB',
      };
      const savedProduct = {
        id: '2',
        ...newProduct,
      } as unknown as ProductEntity;
      productRepository.addProduct.mockResolvedValue(savedProduct);

      const result = await productService.addProduct(newProduct);

      expect(result).toEqual(savedProduct);
      expect(productRepository.addProduct).toHaveBeenCalledWith(newProduct);
    });
  });
});
