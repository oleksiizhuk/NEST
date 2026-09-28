import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  IPmSettingsStore,
  PM_SETTINGS,
} from '@application/project-manager/settings.interface';

// People besides the owner who may open the admin page. The owner adds a
// Telegram username; the first /admin from that username binds its user id,
// and from then on only that id counts (a username can change hands).

export interface AdminUser {
  username: string;
  userId: number | null;
  addedAt: string;
}

const USERNAME = /^[a-z0-9_]{4,32}$/;

export const normalizeUsername = (raw: string): string | null => {
  const u = String(raw ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  return USERNAME.test(u) ? u : null;
};

@Injectable()
export class AdminAccess {
  constructor(
    @Optional() @Inject(PM_SETTINGS) private readonly store?: IPmSettingsStore,
  ) {}

  async list(): Promise<AdminUser[]> {
    if (!this.store) return [];
    return (await this.store.get()).values.adminUsers ?? [];
  }

  // May this Telegram user get an admin link? 'bound' = this call tied the
  // username to the id (the owner is told), 'known' = already bound
  async allowTelegram(from: {
    id: number;
    username: string | null;
  }): Promise<'known' | 'bound' | false> {
    if (!this.store) return false;
    const users = await this.list();
    if (users.some((u) => u.userId === from.id)) return 'known';
    const name = from.username ? normalizeUsername(from.username) : null;
    if (!name || !users.some((u) => u.username === name && u.userId === null))
      return false;
    // Atomic: two people, or a removal, racing with this cannot resurrect or
    // double-bind an entry
    return (await this.store.bindAdmin(name, from.id)) ? 'bound' : false;
  }

  // A session's user is still on the list (removal ends access at once)
  async isAdmin(userId: number): Promise<boolean> {
    return (await this.list()).some((u) => u.userId === userId);
  }

  async add(username: string, by: number): Promise<AdminUser[]> {
    const name = normalizeUsername(username);
    if (!name) throw new Error(`"${username}" is not a Telegram username`);
    const users = await this.list();
    if (users.some((u) => u.username === name)) return users;
    if (users.length >= 10) throw new Error('at most 10 people');
    await this.store?.addAdmin(
      { username: name, userId: null, addedAt: new Date().toISOString() },
      by,
    );
    return this.list();
  }

  async remove(username: string, by: number): Promise<AdminUser[]> {
    const name = normalizeUsername(username);
    if (name) await this.store?.removeAdmin(name, by);
    return this.list();
  }
}
