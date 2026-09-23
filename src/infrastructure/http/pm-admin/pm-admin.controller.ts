import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsObject, IsString, MaxLength } from 'class-validator';
import { PmAdminUseCase } from '@application/project-manager/use-cases/pm-admin.use-case';
import { SettingsError } from '@application/project-manager/settings.interface';
import {
  PmAdminAuth,
  PmAdminGuard,
} from '@infrastructure/http/pm-admin/pm-admin.auth';
import { BadRequestException } from '@nestjs/common';

export class AdminLoginBody {
  @IsString()
  @MaxLength(200)
  token: string;
}

export class AdminSettingsBody {
  @IsObject()
  settings: Record<string, unknown>;
}

@ApiExcludeController()
@Controller('pm-admin')
export class PmAdminController {
  constructor(
    private readonly auth: PmAdminAuth,
    private readonly admin: PmAdminUseCase,
  ) {}

  // Exchanges the one-time link from the bot for a 7-day session
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: AdminLoginBody) {
    const session = await this.auth.login(body.token);
    if (!session) throw new UnauthorizedException('link expired or used');
    return { session };
  }

  @Get('settings')
  @UseGuards(PmAdminGuard)
  settings() {
    return this.admin.settings();
  }

  @Put('settings')
  @UseGuards(PmAdminGuard)
  async update(
    @Body() body: AdminSettingsBody,
    @Req() req: { pmAdmin: number },
  ) {
    try {
      return await this.admin.update(body.settings, req.pmAdmin);
    } catch (error) {
      // Only a bad value is the caller's fault; storage errors stay 5xx
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  // Ends every admin session, this one included
  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  async logoutAll() {
    await this.auth.revokeAll();
    return { ok: true };
  }

  @Get('usage')
  @UseGuards(PmAdminGuard)
  usage() {
    return this.admin.usage();
  }
}
