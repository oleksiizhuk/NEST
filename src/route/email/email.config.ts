import { ConfigService } from '@nestjs/config';

export const emailConfig = (configService: ConfigService) => {
  const config = {
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
  };
  console.log('config = ', config);
  return config;
};
