import { Test, TestingModule } from '@nestjs/testing';
import { GetProductsUseCase } from './get-products.use-case';
import { PRODUCT_REPOSITORY } from '../../../domain/product/product.repository.interface';
import { IPaginationProduct } from '../../../domain/product/product.entity';

const mockPage: IPaginationProduct = {
  items: [],
  totalItems: 0,
  itemCount: 0,
  itemsPerPage: 10,
  totalPages: 0,
  currentPage: 1,
};

describe('GetProductsUseCase', () => {
  let useCase: GetProductsUseCase;
  const mockRepo = { findAll: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetProductsUseCase,
        { provide: PRODUCT_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(GetProductsUseCase);
    jest.clearAllMocks();
  });

  it('calls repository with correct page and limit', async () => {
    mockRepo.findAll.mockResolvedValue(mockPage);
    await useCase.execute(2, 20);
    expect(mockRepo.findAll).toHaveBeenCalledWith(2, 20);
  });

  it('returns paginated result', async () => {
    mockRepo.findAll.mockResolvedValue(mockPage);
    const result = await useCase.execute(1, 10);
    expect(result).toEqual(mockPage);
  });
});
