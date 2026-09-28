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

  // May this Telegram user get an admin link? Binds the id on first use
  async allowTelegram(from: {
    id: number;
    username: string | null;
  }): Promise<boolean> {
    if (!this.store) return false;
    const users = await this.list();
    if (users.some((u) => u.userId === from.id)) return true;
    const name = from.username ? normalizeUsername(from.username) : null;
    const match = name
      ? users.find((u) => u.username === name && u.userId === null)
      : undefined;
    if (!match) return false;
    await this.store.save(
      {
        adminUsers: users.map((u) =>
          u === match ? { ...u, userId: from.id } : u,
        ),
      },
      from.id,
    );
    return true;
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
    const next = [
      ...users,
      { username: name, userId: null, addedAt: new Date().toISOString() },
    ];
    await this.store?.save({ adminUsers: next }, by);
    return next;
  }

  async remove(username: string, by: number): Promise<AdminUser[]> {
    const name = normalizeUsername(username);
    const next = (await this.list()).filter((u) => u.username !== name);
    await this.store?.save({ adminUsers: next }, by);
    return next;
  }
}
