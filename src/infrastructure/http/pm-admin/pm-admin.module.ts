import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PasswordThrottle } from '@infrastructure/http/pm-admin/password-throttle';
import { PmAdminAttemptSchema } from '@infrastructure/database/schemas/pm-admin-attempt.schema';
import { ProjectManagerModule } from '@infrastructure/project-manager/project-manager.module';
import { TelegramInfraModule } from '@infrastructure/telegram/telegram.module';
import { PmAdminController } from '@infrastructure/http/pm-admin/pm-admin.controller';
import {
  PmAdminAuth,
  PmAdminGuard,
} from '@infrastructure/http/pm-admin/pm-admin.auth';
import { PmAdminUseCase } from '@application/project-manager/use-cases/pm-admin.use-case';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: 'PmAdminAttempt', schema: PmAdminAttemptSchema },
    ]),
    ProjectManagerModule,
    TelegramInfraModule,
  ],
  controllers: [PmAdminController],
  providers: [PmAdminAuth, PmAdminGuard, PmAdminUseCase, PasswordThrottle],
})
export class PmAdminHttpModule {}
