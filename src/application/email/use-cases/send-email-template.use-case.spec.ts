import { Test, TestingModule } from '@nestjs/testing';
import { SendEmailTemplateUseCase } from './send-email-template.use-case';
import { EMAIL_SERVICE } from '../email.service.interface';

describe('SendEmailTemplateUseCase', () => {
  let useCase: SendEmailTemplateUseCase;
  const mockEmailService = { sendEmailTemplate: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendEmailTemplateUseCase,
        { provide: EMAIL_SERVICE, useValue: mockEmailService },
      ],
    }).compile();
    useCase = module.get(SendEmailTemplateUseCase);
    jest.clearAllMocks();
  });

  it('sends templated email', async () => {
    mockEmailService.sendEmailTemplate.mockResolvedValue({
      accepted: ['test@test.com'],
    });
    const result = await useCase.execute('test@test.com');
    expect(result).toEqual({ accepted: ['test@test.com'] });
    expect(mockEmailService.sendEmailTemplate).toHaveBeenCalledWith(
      'test@test.com',
    );
  });
});
