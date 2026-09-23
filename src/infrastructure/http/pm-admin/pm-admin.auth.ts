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

const SESSION_TTL = '7d';
const TYP = 'pm-admin';

// Sessions for the admin page: signed with JWT_SECRET, typ "pm-admin", and
// valid only for TELEGRAM_OWNER_ID. The user API's JWT strategy accepts only
// typ "access", so neither token works for the other.
@Injectable()
export class PmAdminAuth {
  private readonly secret: string;
  readonly ownerId: number;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    @Inject(PM_ADMIN_LINKS) private readonly links: IAdminLinks,
    @Inject(PM_SETTINGS) private readonly settings: IPmSettingsStore,
  ) {
    this.secret = config.get<string>('JWT_SECRET') ?? '';
    this.ownerId = Number(config.get<string>('TELEGRAM_OWNER_ID')) || 0;
  }

  async login(token: string, now = new Date()): Promise<string | null> {
    if (!this.secret || !this.ownerId) return null;
    if (!(await this.links.consume(token, now))) return null;
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
