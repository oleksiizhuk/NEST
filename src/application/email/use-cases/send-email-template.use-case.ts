import { Injectable, Inject } from '@nestjs/common';
import {
  IEmailService,
  EMAIL_SERVICE,
} from '@application/email/email.service.interface';

@Injectable()
export class SendEmailTemplateUseCase {
  constructor(
    @Inject(EMAIL_SERVICE) private readonly emailService: IEmailService,
  ) {}

  async execute(email: string): Promise<unknown> {
    return this.emailService.sendEmailTemplate(email);
  }
}
