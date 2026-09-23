import { ForbiddenException } from '@nestjs/common';
import { SendEmailUseCase } from '@application/email/use-cases/send-email.use-case';

describe('SendEmailUseCase', () => {
  const emailService = { sendMail: jest.fn().mockResolvedValue({ ok: true }) };
  const useCase = new SendEmailUseCase(emailService as any);

  beforeEach(() => jest.clearAllMocks());

  it('sends to the caller’s own address', async () => {
    await expect(
      useCase.execute('test@test.com', 'Test@test.com', 'Hello'),
    ).resolves.toEqual({ ok: true });
    expect(emailService.sendMail).toHaveBeenCalledWith(
      'Test@test.com',
      'Hello',
    );
  });

  it('refuses any other recipient', async () => {
    await expect(
      useCase.execute('test@test.com', 'victim@test.com', 'Hello'),
    ).rejects.toThrow(ForbiddenException);
    expect(emailService.sendMail).not.toHaveBeenCalled();
  });
});
