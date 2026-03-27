import { ConfigService } from '@nestjs/config';

export const emailConfig = (configService: ConfigService) => ({
  transport: {
    host: configService.get<string>('MAIL_HOST'),
    port: parseInt(configService.get<string>('MAIL_PORT'), 10),
    auth: {
      user: configService.get<string>('MAIL_USER'),
      pass: configService.get<string>('MAIL_PASS'),
    },
    secure: false,
    pool: true,
  },
});
