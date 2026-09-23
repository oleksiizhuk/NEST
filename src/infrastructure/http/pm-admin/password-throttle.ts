import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PmAdminAttemptDocument } from '@infrastructure/database/schemas/pm-admin-attempt.schema';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
const KEY = 'password';

// One counter for the whole account, not per IP: spreading guesses over
// many addresses does not help. The cost is that a guesser can lock the
// password login for 15 minutes; the Telegram link still works then.
@Injectable()
export class PasswordThrottle {
  constructor(
    @InjectModel('PmAdminAttempt')
    private readonly model: Model<PmAdminAttemptDocument>,
  ) {}

  async blocked(now: Date): Promise<boolean> {
    const doc = await this.model.findOne({ key: KEY }).lean();
    return Boolean(
      doc &&
        doc.failures >= MAX_FAILURES &&
        now.getTime() - new Date(doc.windowStart).getTime() < WINDOW_MS,
    );
  }

  async fail(now: Date): Promise<void> {
    const doc = await this.model.findOne({ key: KEY }).lean();
    const fresh =
      !doc || now.getTime() - new Date(doc.windowStart).getTime() >= WINDOW_MS;
    await this.model.updateOne(
      { key: KEY },
      fresh
        ? {
            $set: {
              failures: 1,
              windowStart: now,
              expiresAt: new Date(now.getTime() + WINDOW_MS),
            },
          }
        : { $inc: { failures: 1 } },
      { upsert: true },
    );
  }

  async reset(): Promise<void> {
    await this.model.deleteOne({ key: KEY });
  }
}
