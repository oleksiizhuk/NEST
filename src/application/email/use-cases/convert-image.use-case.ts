import { Injectable, Inject } from '@nestjs/common';
import { IEmailService, EMAIL_SERVICE } from '@application/email/email.service.interface';

@Injectable()
export class ConvertImageUseCase {
  constructor(
    @Inject(EMAIL_SERVICE) private readonly emailService: IEmailService,
  ) {}

  async execute(buffer: Buffer): Promise<{ text: string }> {
    return this.emailService.convertImage(buffer);
  }
}
