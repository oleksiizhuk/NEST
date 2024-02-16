import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { OcrService } from '../../service/ocr/ocr.service';
import Handlebars from 'handlebars';
import { html } from '../../assets/html';

@Injectable()
export class EmailingService {
  constructor(
    private readonly mailService: MailerService,
    private readonly configService: ConfigService,
    private readonly ocrService: OcrService,
  ) {}

  private generationTemplate(html: string, templateVariable) {
    const templateFunction = Handlebars.compile(html);
    return templateFunction(templateVariable);
  }

  private generateTemplateVariable() {
    return {
      deepLinkUrl: `pizzahut://test-link?token=token`,
    };
  }

  async sendEmailTemple(email) {
    const sender = {
      name: this.configService.get<string>('APP_NAME'),
      address: this.configService.get<string>('MAIL_SENDER'),
    };

    const variable = this.generateTemplateVariable();

    const bodyHtml = this.generationTemplate(html, variable);
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

  async convertImage(image) {
    const text = await this.ocrService.convertImageToText(image.buffer);
    return { text };
  }
}
