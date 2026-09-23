import { ForbiddenException } from '@nestjs/common';
import { SendEmailTemplateUseCase } from '@application/email/use-cases/send-email-template.use-case';

describe('SendEmailTemplateUseCase', () => {
  const emailService = {
    sendEmailTemplate: jest.fn().mockResolvedValue({ ok: true }),
  };
  const useCase = new SendEmailTemplateUseCase(emailService as any);

  beforeEach(() => jest.clearAllMocks());

  it('sends the template to the caller’s own address', async () => {
    await expect(
      useCase.execute('test@test.com', 'test@test.com'),
    ).resolves.toEqual({ ok: true });
    expect(emailService.sendEmailTemplate).toHaveBeenCalledWith(
      'test@test.com',
    );
  });

  it('refuses any other recipient', async () => {
    await expect(
      useCase.execute('test@test.com', 'victim@test.com'),
    ).rejects.toThrow(ForbiddenException);
  });
});
