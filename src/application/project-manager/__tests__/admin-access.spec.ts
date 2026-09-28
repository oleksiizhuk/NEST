import { AdminAccess } from '@application/project-manager/admin-access';

const store = (adminUsers: any[] = []) => {
  const state = { adminUsers };
  return {
    get: jest.fn(async () => ({ values: { ...state }, updatedAt: null })),
    save: jest.fn(async (v: any) => Object.assign(state, v)),
    sessionEpoch: jest.fn(),
    bumpSessionEpoch: jest.fn(),
    setAway: jest.fn(),
    hideToday: jest.fn(),
  };
};

describe('AdminAccess', () => {
  it('binds the Telegram id on the first /admin, then only that id counts', async () => {
    const s = store();
    const access = new AdminAccess(s as any);
    await access.add('@Anna_K', 42);
    expect(await access.isAdmin(5)).toBe(false);
    expect(await access.allowTelegram({ id: 5, username: 'anna_k' })).toBe(
      true,
    );
    expect(await access.isAdmin(5)).toBe(true);
    // Someone who later takes the username gets nothing
    expect(await access.allowTelegram({ id: 6, username: 'anna_k' })).toBe(
      false,
    );
    // The bound person still works after renaming
    expect(await access.allowTelegram({ id: 5, username: 'new_name' })).toBe(
      true,
    );
    await access.remove('anna_k', 42);
    expect(await access.isAdmin(5)).toBe(false);
  });

  it('refuses bad usernames and strangers', async () => {
    const access = new AdminAccess(store() as any);
    await expect(access.add('a b', 42)).rejects.toThrow(
      'not a Telegram username',
    );
    expect(await access.allowTelegram({ id: 9, username: null })).toBe(false);
  });
});
