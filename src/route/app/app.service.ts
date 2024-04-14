import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}
  getHello(): string {
    return `Hello World! ${this.configService.get<string>(
      'MAIL_HOST',
    )} ${this.configService.get<string>('B_API_KEY')}`;
  }
}
