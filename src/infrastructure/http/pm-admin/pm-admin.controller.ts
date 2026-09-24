import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PmAdminUseCase } from '@application/project-manager/use-cases/pm-admin.use-case';
import { TeamReviewUseCase } from '@application/project-manager/use-cases/team-review.use-case';
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

export class AdminPasswordBody {
  @IsString()
  @MaxLength(200)
  email: string;

  @IsString()
  @MaxLength(200)
  password: string;
}

export class AdminApprovalBody {
  @IsString()
  @MaxLength(64)
  id: string;
}

export class AdminTeamReviewBody {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class AdminGithubBody {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(39)
  login?: string | null;
}

export class AdminChatBody {
  @IsInt()
  chatId: number;

  // PM mode: true / false, or "auto" to go back to the default
  @IsOptional()
  @IsIn([true, false, 'auto'])
  on?: boolean | 'auto';

  // Proactive alerts to this chat
  @IsOptional()
  @IsBoolean()
  alerts?: boolean;
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
    private readonly team_: TeamReviewUseCase,
  ) {}

  // Exchanges the one-time link from the bot for a 7-day session
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: AdminLoginBody) {
    const session = await this.auth.login(body.token);
    if (!session) throw new UnauthorizedException('link expired or used');
    return { session };
  }

  // Step 1: email + password; on success the owner gets a Telegram prompt
  @Post('password-login')
  @HttpCode(200)
  async passwordLogin(@Body() body: AdminPasswordBody) {
    const result = await this.auth.loginWithPassword(body.email, body.password);
    if ('pending' in result) return { pending: result.pending, seconds: 120 };
    if (result.error === 'locked')
      throw new HttpException(
        'Вход по паролю закрыт на 15 минут: было много неверных попыток или вход отклонили в Telegram.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (result.error === 'busy')
      throw new HttpException(
        'Не получилось отправить подтверждение в Telegram. Попробуйте через минуту.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    if (result.error === 'off')
      throw new UnauthorizedException('Вход по паролю не настроен.');
    throw new UnauthorizedException('Неверный email или пароль.');
  }

  // Step 2: the page polls until the owner taps a button (or 2 minutes pass)
  @Post('password-login/status')
  @HttpCode(200)
  async passwordLoginStatus(@Body() body: AdminApprovalBody) {
    const result = await this.auth.approval(body.id);
    if ('session' in result || 'pending' in result) return result;
    throw new UnauthorizedException(
      result.error === 'denied'
        ? 'Вход отклонён в Telegram.'
        : 'Время на подтверждение вышло. Войдите ещё раз.',
    );
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

  // Сотрудники: who is on what, computed from the latest snapshot
  @Get('team')
  @UseGuards(PmAdminGuard)
  async team() {
    const [team, review] = await Promise.all([
      this.team_.team(),
      this.team_.latest(),
    ]);
    return { team, review };
  }

  // Meeting notes by the model (cached for the day unless force)
  @Post('team/review')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  async teamReview(@Body() body: AdminTeamReviewBody) {
    try {
      return await this.team_.review(Boolean(body.force));
    } catch (error) {
      throw new HttpException(
        (error as Error).message,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  // Links a Jira name to a GitHub login (null removes the link)
  @Put('team/github')
  @UseGuards(PmAdminGuard)
  async teamGithub(
    @Body() body: AdminGithubBody,
    @Req() req: { pmAdmin: number },
  ) {
    try {
      await this.admin.setGithubLogin(
        body.name,
        body.login ?? null,
        req.pmAdmin,
      );
      return this.team();
    } catch (error) {
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  @Get('chats')
  @UseGuards(PmAdminGuard)
  chats() {
    return this.admin.groups();
  }

  @Put('chats')
  @UseGuards(PmAdminGuard)
  async setChat(@Body() body: AdminChatBody, @Req() req: { pmAdmin: number }) {
    try {
      if (body.alerts !== undefined)
        return await this.admin.setAlerts(
          body.chatId,
          body.alerts,
          req.pmAdmin,
        );
      if (body.on === undefined) throw new SettingsError('on or alerts');
      return await this.admin.setGroup(body.chatId, body.on);
    } catch (error) {
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }
}
