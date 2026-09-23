import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { IPasswordHasher } from '@application/auth/password-hasher.interface';

const ROUNDS = 10;
const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/;
// A real hash of a throwaway value, compared against when there is nothing
// stored, so a missing account takes as long as a wrong password.
const DUMMY_HASH =
  '$2a$10$TL4zlkktyUhux53Mr5vW4u3n6Qe40TLOCUEOejhGxSRseosyJdRKa';

@Injectable()
export class BcryptPasswordHasher implements IPasswordHasher {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, ROUNDS);
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    if (!stored) {
      await bcrypt.compare(plain, DUMMY_HASH);
      return false;
    }
    if (!this.isLegacy(stored)) return bcrypt.compare(plain, stored);
    const a = Buffer.from(plain);
    const b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  isLegacy(stored: string): boolean {
    return !BCRYPT_PREFIX.test(stored);
  }
}
