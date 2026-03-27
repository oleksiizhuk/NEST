import { Test, TestingModule } from '@nestjs/testing';
import { SendEmailUseCase } from '../send-email.use-case';
import { EMAIL_SERVICE } from '../../email.service.interface';

describe('SendEmailUseCase', () => {
  let useCase: SendEmailUseCase;
  const mockEmailService = { sendMail: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendEmailUseCase,
        { provide: EMAIL_SERVICE, useValue: mockEmailService },
      ],
    }).compile();
    useCase = module.get(SendEmailUseCase);
    jest.clearAllMocks();
  });

  it('sends email with email and message', async () => {
    mockEmailService.sendMail.mockResolvedValue({
      accepted: ['test@test.com'],
    });
    const result = await useCase.execute('test@test.com', 'Hello');
    expect(result).toEqual({ accepted: ['test@test.com'] });
    expect(mockEmailService.sendMail).toHaveBeenCalledWith(
      'test@test.com',
      'Hello',
    );
  });
});
