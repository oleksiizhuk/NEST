import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  IAdminLinks,
  PM_ADMIN_LINKS,
} from '@application/project-manager/admin-links.interface';
import {
  IPmSettingsStore,
  PM_SETTINGS,
} from '@application/project-manager/settings.interface';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import * as bcrypt from 'bcryptjs';
import { PasswordThrottle } from '@infrastructure/http/pm-admin/password-throttle';

export type PasswordLogin =
  | { session: string }
  | { error: 'invalid' | 'locked' | 'off' };

const SESSION_TTL = '7d';
const TYP = 'pm-admin';

// Sessions for the admin page: signed with JWT_SECRET, typ "pm-admin", and
// valid only for TELEGRAM_OWNER_ID. The user API's JWT strategy accepts only
// typ "access", so neither token works for the other.
@Injectable()
export class PmAdminAuth {
  private readonly secret: string;
  readonly ownerId: number;
  private readonly email: string;
  private readonly passwordHash: string;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    @Inject(PM_ADMIN_LINKS) private readonly links: IAdminLinks,
    @Inject(PM_SETTINGS) private readonly settings: IPmSettingsStore,
    private readonly throttle: PasswordThrottle,
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
  ) {
    this.email = (config.get<string>('PM_ADMIN_EMAIL') ?? '')
      .trim()
      .toLowerCase();
    this.passwordHash = config.get<string>('PM_ADMIN_PASSWORD_HASH') ?? '';
    this.secret = config.get<string>('JWT_SECRET') ?? '';
    this.ownerId = Number(config.get<string>('TELEGRAM_OWNER_ID')) || 0;
  }

  async login(token: string, now = new Date()): Promise<string | null> {
    if (!this.secret || !this.ownerId) return null;
    if (!(await this.links.consume(token, now))) return null;
    return this.session();
  }

  // Email + password (bcrypt hash in PM_ADMIN_PASSWORD_HASH). Off unless
  // both are set; 5 failures in 15 minutes lock it; every success is
  // reported to the owner in Telegram.
  async loginWithPassword(
    email: string,
    password: string,
    now = new Date(),
  ): Promise<PasswordLogin> {
    if (!this.secret || !this.ownerId || !this.email || !this.passwordHash)
      return { error: 'off' };
    if (await this.throttle.blocked(now)) return { error: 'locked' };
    const emailOk = email.trim().toLowerCase() === this.email;
    // Compare even for a wrong email, so timing does not reveal which part failed
    const passwordOk = await bcrypt.compare(password, this.passwordHash);
    if (!emailOk || !passwordOk) {
      await this.throttle.fail(now);
      return { error: 'invalid' };
    }
    await this.throttle.reset();
    await this.telegram
      .sendMessage(
        this.ownerId,
        `Вход в админку по паролю: ${now
          .toISOString()
          .slice(0, 16)
          .replace(
            'T',
            ' ',
          )} UTC. Если это не вы — нажмите «Выйти везде» в админке и смените пароль.`,
      )
      .catch(() => undefined);
    return { session: await this.session() };
  }

  private async session(): Promise<string> {
    const v = await this.settings.sessionEpoch();
    return this.jwt.sign(
      { sub: String(this.ownerId), typ: TYP, v },
      { secret: this.secret, expiresIn: SESSION_TTL },
    );
  }

  // The owner's id when the session is valid and not revoked, else null
  async verify(session: string): Promise<number | null> {
    if (!this.secret || !this.ownerId) return null;
    let payload: { sub?: string; typ?: string; v?: number };
    try {
      payload = this.jwt.verify(session, { secret: this.secret });
    } catch {
      return null;
    }
    if (payload.typ !== TYP || payload.sub !== String(this.ownerId))
      return null;
    // "Log out everywhere" raises the epoch; older sessions stop working
    const epoch = await this.settings.sessionEpoch().catch(() => null);
    if (epoch === null || (payload.v ?? 0) !== epoch) return null;
    return this.ownerId;
  }

  async revokeAll(): Promise<void> {
    await this.settings.bumpSessionEpoch();
  }
}

@Injectable()
export class PmAdminGuard implements CanActivate {
  constructor(private readonly auth: PmAdminAuth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = String(req.headers?.authorization ?? '');
    const [scheme, token] = header.split(' ');
    const owner =
      scheme === 'Bearer' && token ? await this.auth.verify(token) : null;
    if (owner === null) throw new UnauthorizedException();
    req.pmAdmin = owner;
    return true;
  }
}
