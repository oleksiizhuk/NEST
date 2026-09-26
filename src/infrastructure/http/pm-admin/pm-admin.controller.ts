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
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import { BuildIndexUseCase } from '@application/project-manager/use-cases/build-index.use-case';
import { SettingsError } from '@application/project-manager/settings.interface';
import { ReviewKind } from '@application/project-manager/team-reviews.interface';
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

  @IsOptional()
  @IsIn(['meeting', 'standup', 'retro', 'oneonone'])
  kind?: 'meeting' | 'standup' | 'retro' | 'oneonone';

  // For a 1:1: the Jira display name
  @IsOptional()
  @IsString()
  @MaxLength(100)
  person?: string;
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

export class AdminAwayBody {
  @IsString()
  @MaxLength(100)
  name: string;

  // YYYY-MM-DD, inclusive; null or missing brings the person back
  @IsOptional()
  @IsString()
  @MaxLength(10)
  until?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  note?: string | null;
}

export class AdminTodayHideBody {
  @IsString()
  @MaxLength(300)
  id: string;

  @IsIn([1, 7])
  days: 1 | 7;
}

export class AdminBaselineBody {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date?: string | null;
}

export class AdminTelegramBody {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(33)
  username?: string | null;
}

export class AdminNudgeBody {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(800)
  text: string;

  @IsInt()
  chatId: number;
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
    private readonly refresher: RefreshProjectSnapshotUseCase,
    private readonly indexer: BuildIndexUseCase,
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

  // Поток: time per stage, aging work, bounces, handoffs, blocked time
  @Get('flow')
  @UseGuards(PmAdminGuard)
  flow() {
    return this.team_.flow();
  }

  // Качество: bugs by area and areas only one person knows
  @Get('areas')
  @UseGuards(PmAdminGuard)
  areas() {
    return this.team_.areas();
  }

  // Релиз: will it land on the date, what grew, what the rest waits on
  @Get('release')
  @UseGuards(PmAdminGuard)
  release() {
    return this.team_.release();
  }

  // Scope growth is counted from this day; null = the last 30 days
  @Put('release/baseline')
  @UseGuards(PmAdminGuard)
  async releaseBaseline(
    @Body() body: AdminBaselineBody,
    @Req() req: { pmAdmin: number },
  ) {
    try {
      await this.admin.update(
        { releaseBaseline: body.date ?? null },
        req.pmAdmin,
      );
      return this.team_.release();
    } catch (error) {
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  // The latest notes of one kind, without calling the model
  @Post('team/review/latest')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  async reviewLatest(@Body() body: AdminTeamReviewBody) {
    const kind: ReviewKind =
      body.kind === 'oneonone'
        ? `oneonone:${body.person ?? ''}`
        : body.kind ?? 'meeting';
    // Wrapped: a bare null would go out as an empty body
    return { notes: await this.team_.latestOf(kind) };
  }

  // Load per person per day, 4 weeks, for the heatmap
  @Get('team/history')
  @UseGuards(PmAdminGuard)
  teamHistory() {
    return this.team_.teamHistory();
  }

  // Meeting notes by the model (cached for the day unless force)
  @Post('team/review')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  async teamReview(@Body() body: AdminTeamReviewBody) {
    try {
      const kind: ReviewKind =
        body.kind === 'oneonone'
          ? `oneonone:${body.person ?? ''}`
          : body.kind ?? 'meeting';
      return await this.team_.review(Boolean(body.force), new Date(), kind);
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

  // Links a Jira name to a Telegram username (null removes the link)
  @Put('team/telegram')
  @UseGuards(PmAdminGuard)
  async teamTelegram(
    @Body() body: AdminTelegramBody,
    @Req() req: { pmAdmin: number },
  ) {
    try {
      await this.admin.setTelegramUsername(
        body.name,
        body.username || null,
        req.pmAdmin,
      );
      return this.team();
    } catch (error) {
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  // Sends the owner's message to a PM group, mentioning the person
  @Post('team/nudge')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  async teamNudge(@Body() body: AdminNudgeBody) {
    try {
      return await this.admin.nudge(body.name, body.text, body.chatId);
    } catch (error) {
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  // Marks a person away so their signals stay quiet
  @Put('team/away')
  @UseGuards(PmAdminGuard)
  async teamAway(@Body() body: AdminAwayBody, @Req() req: { pmAdmin: number }) {
    try {
      await this.admin.setAway(
        body.name,
        body.until || null,
        body.note ?? null,
        req.pmAdmin,
      );
      return this.team();
    } catch (error) {
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  // Сегодня: the few things to act on across the team
  @Get('today')
  @UseGuards(PmAdminGuard)
  today() {
    return this.admin.today();
  }

  @Post('today/hide')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  async todayHide(
    @Body() body: AdminTodayHideBody,
    @Req() req: { pmAdmin: number },
  ) {
    try {
      return await this.admin.hideToday(body.id, body.days, req.pmAdmin);
    } catch (error) {
      if (error instanceof SettingsError)
        throw new BadRequestException(error.message);
      throw error;
    }
  }

  // Rebuilds the project snapshot now (Jira, docs, GitHub, design), like
  // /refresh in the bot; takes up to a minute
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  async refresh() {
    const snapshot = await this.refresher.execute();
    return {
      at: snapshot.createdAt,
      sources: snapshot.sections.map((s) => ({
        source: s.source,
        ok: s.ok,
        error: s.error,
      })),
    };
  }

  // Full collection of tickets, docs, design and PRs into the local index,
  // in steps (each call ~3 minutes at most); no model tokens
  @Get('index')
  @UseGuards(PmAdminGuard)
  indexStatus() {
    return this.indexer.status();
  }

  @Post('index/start')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  indexStart() {
    return this.indexer.start();
  }

  @Post('index/step')
  @HttpCode(200)
  @UseGuards(PmAdminGuard)
  indexStep() {
    return this.indexer.step();
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
