import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
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
    ProjectManagerModule,
    TelegramInfraModule,
  ],
  controllers: [PmAdminController],
  providers: [PmAdminAuth, PmAdminGuard, PmAdminUseCase],
})
export class PmAdminHttpModule {}
