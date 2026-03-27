import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailingService } from './email.service';
import { OcrModule } from '../ocr/ocr.module';
import { emailConfig } from './email.config';
import { EMAIL_SERVICE } from '../../application/email/email.service.interface';

@Module({
  imports: [
    ConfigModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => emailConfig(configService),
    }),
    OcrModule,
  ],
  providers: [
    EmailingService,
    { provide: EMAIL_SERVICE, useClass: EmailingService },
  ],
  exports: [EMAIL_SERVICE, MailerModule],
})
export class EmailInfraModule {}
