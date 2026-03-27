import { Module } from '@nestjs/common';
import { EmailController } from '@infrastructure/http/email/email.controller';
import { SendEmailUseCase } from '@application/email/use-cases/send-email.use-case';
import { SendEmailTemplateUseCase } from '@application/email/use-cases/send-email-template.use-case';
import { ConvertImageUseCase } from '@application/email/use-cases/convert-image.use-case';
import { EmailInfraModule } from '@infrastructure/email/email.module';

@Module({
  imports: [EmailInfraModule],
  controllers: [EmailController],
  providers: [SendEmailUseCase, SendEmailTemplateUseCase, ConvertImageUseCase],
})
export class EmailHttpModule {}
