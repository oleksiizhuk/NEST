import { ForbiddenException } from '@nestjs/common';
import { PmAdminController } from '@infrastructure/http/pm-admin/pm-admin.controller';

describe('PmAdminController owner-only actions', () => {
  const admin = {
    update: jest.fn().mockResolvedValue({}),
    setGroup: jest.fn(),
    setAlerts: jest.fn(),
    addAdmin: jest.fn(),
    removeAdmin: jest.fn(),
  };
  const auth = { ownerId: 42, revokeAll: jest.fn() };
  const controller = new PmAdminController(
    auth as any,
    admin as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const other = { pmAdmin: 77 };
  const owner = { pmAdmin: 42 };

  it('keeps access-granting changes with the owner', async () => {
    await expect(
      controller.update({ settings: { actionUserIds: [77] } }, other),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.update({ settings: { dailyQuestionLimit: 5 } }, other),
    ).resolves.toEqual({});
    await expect(
      controller.setChat({ chatId: -5, on: true }, other),
    ).rejects.toThrow(ForbiddenException);
    await expect(controller.logoutAll(other)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      controller.addAdmin({ username: 'x_user' }, other),
    ).rejects.toThrow(ForbiddenException);
    await controller.update({ settings: { actionUserIds: [77] } }, owner);
    expect(admin.update).toHaveBeenLastCalledWith({ actionUserIds: [77] }, 42);
    await controller.logoutAll(owner);
    expect(auth.revokeAll).toHaveBeenCalledTimes(1);
  });
});
