import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { EmailController } from './email.controler';
import { EmailingService } from './email.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { emailConfig } from './email.config';

@Module({
  controllers: [EmailController],
  providers: [EmailingService],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) =>
        emailConfig(configService),
    }),
  ],
  exports: [MailerModule],
})
export class EmailModule {}
