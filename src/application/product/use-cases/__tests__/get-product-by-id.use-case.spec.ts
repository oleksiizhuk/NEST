import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GetProductByIdUseCase } from '../get-product-by-id.use-case';
import { PRODUCT_REPOSITORY } from '../../../../domain/product/product.repository.interface';
import { Product } from '../../../../domain/product/product.entity';

const mockProduct = new Product(
  'p1',
  0,
  'phone',
  '',
  'iPhone',
  '',
  999,
  0,
  '',
  '',
  '',
);

describe('GetProductByIdUseCase', () => {
  let useCase: GetProductByIdUseCase;
  const mockRepo = { findById: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetProductByIdUseCase,
        { provide: PRODUCT_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(GetProductByIdUseCase);
    jest.clearAllMocks();
  });

  it('returns product when found', async () => {
    mockRepo.findById.mockResolvedValue(mockProduct);
    const result = await useCase.execute('p1');
    expect(result).toBe(mockProduct);
    expect(mockRepo.findById).toHaveBeenCalledWith('p1');
  });

  it('throws NotFoundException when product not found', async () => {
    mockRepo.findById.mockResolvedValue(null);
    await expect(useCase.execute('unknown')).rejects.toThrow(NotFoundException);
  });
});
