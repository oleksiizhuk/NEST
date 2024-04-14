import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  constructor(
    private readonly mailService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendMail(email, message) {
    const sender = {
      name: this.configService.get<string>('APP_NAME'),
      address: this.configService.get<string>('MAIL_SENDER'),
    };
    try {
      return await this.mailService.sendMail({
        from: sender,
        to: email,
        subject: 'Testing Nest MailerModule',
        text: 'welcome',
        html: `<b>${message}</b>`,
      });
    } catch (e) {
      console.log('error', e);
    }
  }
}
