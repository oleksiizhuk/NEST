import { Test, TestingModule } from '@nestjs/testing';
import { ConvertImageUseCase } from './convert-image.use-case';
import { EMAIL_SERVICE } from '../email.service.interface';

describe('ConvertImageUseCase', () => {
  let useCase: ConvertImageUseCase;
  const mockEmailService = { convertImage: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConvertImageUseCase,
        { provide: EMAIL_SERVICE, useValue: mockEmailService },
      ],
    }).compile();
    useCase = module.get(ConvertImageUseCase);
    jest.clearAllMocks();
  });

  it('converts image buffer to text', async () => {
    const buffer = Buffer.from('fake-image');
    mockEmailService.convertImage.mockResolvedValue({ text: 'Hello World' });
    const result = await useCase.execute(buffer);
    expect(result).toEqual({ text: 'Hello World' });
    expect(mockEmailService.convertImage).toHaveBeenCalledWith(buffer);
  });
});
