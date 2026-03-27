import { Injectable, Inject } from '@nestjs/common';
import { IEmailService, EMAIL_SERVICE } from '@application/email/email.service.interface';

@Injectable()
export class SendEmailUseCase {
  constructor(
    @Inject(EMAIL_SERVICE) private readonly emailService: IEmailService,
  ) {}

  async execute(email: string, message: string): Promise<unknown> {
    return this.emailService.sendMail(email, message);
  }
}
