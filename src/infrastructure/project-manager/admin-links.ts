import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, randomBytes } from 'crypto';
import { IAdminLinks } from '@application/project-manager/admin-links.interface';
import { PmAdminLoginDocument } from '@infrastructure/database/schemas/pm-admin-login.schema';

const LINK_TTL_MS = 10 * 60_000;

const hash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// Where the admin page lives: PM_ADMIN_URL, else the webhook's origin, else
// the production host Vercel reports
export const adminBaseUrl = (config: ConfigService): string | null => {
  const explicit = config.get<string>('PM_ADMIN_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const webhook = config.get<string>('TELEGRAM_WEBHOOK_URL');
  if (webhook) {
    try {
      return new URL(webhook).origin;
    } catch {
      // fall through
    }
  }
  const host = config.get<string>('VERCEL_PROJECT_PRODUCTION_URL');
  return host ? `https://${host}` : null;
};

@Injectable()
export class MongoAdminLinks implements IAdminLinks {
  private readonly base: string | null;

  constructor(
    config: ConfigService,
    @InjectModel('PmAdminLogin')
    private readonly model: Model<PmAdminLoginDocument>,
  ) {
    this.base = adminBaseUrl(config);
  }

  async issue(now: Date): Promise<string> {
    if (!this.base)
      throw new Error('admin URL is not configured (PM_ADMIN_URL)');
    const token = randomBytes(32).toString('base64url');
    await this.model.create({
      tokenHash: hash(token),
      expiresAt: new Date(now.getTime() + LINK_TTL_MS),
    });
    // In the fragment: it never reaches server logs or the Referer header
    return `${this.base}/admin/#login=${token}`;
  }

  // Atomic: a link works once even if opened twice at the same moment
  async consume(token: string, now: Date): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return false;
    const doc = await this.model.findOneAndUpdate(
      { tokenHash: hash(token), usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    );
    return Boolean(doc);
  }
}
