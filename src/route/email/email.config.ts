import { ConfigService } from '@nestjs/config';

export const emailConfig = (configService: ConfigService) => {
  const test = {
    transport: {
      host: configService.get<string>('MAIL_HOST'),
      port: parseInt(configService.get<string>('MAIL_PORT'), 10),
      secure: false,
      auth: {
        user: configService.get<string>('MAIL_USER'),
        pass: configService.get<string>('MAIL_PASS'),
      },
      pool: true,
    },
    defaults: {
      from: configService.get<string>('MAIL_SENDER'),
    },
  };

  console.log('test = ', test);

  return {
    transport: {
      host: configService.get<string>('MAIL_HOST'),
      port: parseInt(configService.get<string>('MAIL_PORT'), 10),
      secure: false,
      auth: {
        user: configService.get<string>('MAIL_USER'),
        pass: configService.get<string>('MAIL_PASS'),
      },
      pool: true,
    },
    defaults: {
      from: configService.get<string>('MAIL_SENDER'),
    },
  };
};
