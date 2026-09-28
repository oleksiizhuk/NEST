import { AdminAccess } from '@application/project-manager/admin-access';

// A store that behaves like the Mongo one: each change is one atomic step
const store = () => {
  let users: any[] = [];
  return {
    get: jest.fn(async () => ({
      values: { adminUsers: users.map((u) => ({ ...u })) },
      updatedAt: null,
    })),
    save: jest.fn(),
    addAdmin: jest.fn(async (u: any) => {
      if (!users.some((x) => x.username === u.username)) users.push(u);
    }),
    removeAdmin: jest.fn(async (name: string) => {
      users = users.filter((u) => u.username !== name);
    }),
    bindAdmin: jest.fn(async (name: string, id: number) => {
      const u = users.find((x) => x.username === name && x.userId === null);
      if (!u) return false;
      u.userId = id;
      return true;
    }),
    sessionEpoch: jest.fn(),
    bumpSessionEpoch: jest.fn(),
    setAway: jest.fn(),
    hideToday: jest.fn(),
  };
};

describe('AdminAccess', () => {
  it('binds the Telegram id on the first /admin, then only that id counts', async () => {
    const access = new AdminAccess(store() as any);
    await access.add('@Anna_K', 42);
    expect(await access.isAdmin(5)).toBe(false);
    expect(await access.allowTelegram({ id: 5, username: 'anna_k' })).toBe(
      'bound',
    );
    expect(await access.isAdmin(5)).toBe(true);
    // Someone who later takes the username gets nothing
    expect(await access.allowTelegram({ id: 6, username: 'anna_k' })).toBe(
      false,
    );
    // The bound person still works after renaming
    expect(await access.allowTelegram({ id: 5, username: 'new_name' })).toBe(
      'known',
    );
    await access.remove('anna_k', 42);
    expect(await access.isAdmin(5)).toBe(false);
  });

  it('does not bind when the entry was removed meanwhile', async () => {
    const s = store();
    const access = new AdminAccess(s as any);
    await access.add('anna_k', 42);
    // The owner removes her between the list read and the bind
    s.bindAdmin.mockImplementationOnce(async () => false);
    expect(await access.allowTelegram({ id: 5, username: 'anna_k' })).toBe(
      false,
    );
  });

  it('refuses bad usernames and strangers', async () => {
    const access = new AdminAccess(store() as any);
    await expect(access.add('a b', 42)).rejects.toThrow(
      'not a Telegram username',
    );
    expect(await access.allowTelegram({ id: 9, username: null })).toBe(false);
  });
});
