import { Test, TestingModule } from '@nestjs/testing';
import { AddProductUseCase } from '../add-product.use-case';
import { PRODUCT_REPOSITORY } from '../../../../domain/product/product.repository.interface';
import { Product } from '../../../../domain/product/product.entity';

const dto = {
  age: 1,
  type: 'phone',
  imageUrl: '',
  name: 'iPhone',
  snippet: '',
  price: 999,
  discount: 0,
  screen: '',
  capacity: '',
  ram: '',
};
const created = new Product(
  'p1',
  1,
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

describe('AddProductUseCase', () => {
  let useCase: AddProductUseCase;
  const mockRepo = { create: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddProductUseCase,
        { provide: PRODUCT_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();
    useCase = module.get(AddProductUseCase);
    jest.clearAllMocks();
  });

  it('creates and returns product', async () => {
    mockRepo.create.mockResolvedValue(created);
    const result = await useCase.execute(dto);
    expect(result).toBe(created);
    expect(mockRepo.create).toHaveBeenCalledWith(dto);
  });
});
