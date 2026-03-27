import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { OcrService } from '../ocr/ocr.service';
import Handlebars from 'handlebars';
import { html } from '../../assets/html';
import { IEmailService } from '../../application/email/email.service.interface';

@Injectable()
export class EmailingService implements IEmailService {
  constructor(
    private readonly mailService: MailerService,
    private readonly configService: ConfigService,
    private readonly ocrService: OcrService,
  ) {}

  private generationTemplate(template: string, variables: object): string {
    const templateFunction = Handlebars.compile(template);
    return templateFunction(variables);
  }

  private generateTemplateVariable(): object {
    return { deepLinkUrl: `pizzahut://test-link?token=token` };
  }

  async sendEmailTemplate(email: string): Promise<unknown> {
    const sender = {
      name: this.configService.get<string>('APP_NAME'),
      address: this.configService.get<string>('MAIL_SENDER'),
    };
    const bodyHtml = this.generationTemplate(
      html,
      this.generateTemplateVariable(),
    );
    try {
      return await this.mailService.sendMail({
        from: sender,
        to: email,
        subject: 'Testing Nest MailerModule',
        text: 'welcome',
        html: bodyHtml,
      });
    } catch (e) {
      console.log('error = ', e);
    }
  }

  async sendMail(email: string, message: string): Promise<unknown> {
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

  async convertImage(buffer: Buffer): Promise<{ text: string }> {
    const text = await this.ocrService.convertImageToText(buffer);
    return { text };
  }
}
