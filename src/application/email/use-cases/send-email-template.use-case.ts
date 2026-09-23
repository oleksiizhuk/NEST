import { Injectable, Inject } from '@nestjs/common';
import {
  IEmailService,
  EMAIL_SERVICE,
} from '@application/email/email.service.interface';
import { assertOwnRecipient } from '@application/email/assert-own-recipient';

@Injectable()
export class SendEmailTemplateUseCase {
  constructor(
    @Inject(EMAIL_SERVICE) private readonly emailService: IEmailService,
  ) {}

  async execute(requesterEmail: string, email: string): Promise<unknown> {
    assertOwnRecipient(requesterEmail, email);
    return this.emailService.sendEmailTemplate(email);
  }
}
