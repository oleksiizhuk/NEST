import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PmAdminController } from '@infrastructure/http/pm-admin/pm-admin.controller';
import {
  TopicError,
  TopicLimitError,
} from '@application/project-manager/use-cases/admin-topics.use-case';

describe('PmAdminController owner-only actions', () => {
  const admin = {
    update: jest.fn().mockResolvedValue({}),
    setGroup: jest.fn(),
    setAlerts: jest.fn(),
    addAdmin: jest.fn(),
    removeAdmin: jest.fn(),
  };
  const auth = { ownerId: 42, revokeAll: jest.fn() };
  const topics = { ask: jest.fn().mockResolvedValue({}) };
  const controller = new PmAdminController(
    auth as any,
    admin as any,
    {} as any,
    {} as any,
    {} as any,
    topics as any,
  );
  const other = { pmAdmin: 77 };
  const owner = { pmAdmin: 42 };

  it('keeps access-granting changes with the owner', async () => {
    await expect(
      controller.update({ settings: { actionUserIds: [77] } }, other),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.update({ settings: { dailyQuestionLimit: 0 } }, other),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      controller.update({ settings: { aiEffort: 'low' } }, other),
    ).resolves.toEqual({});
    expect(() => controller.admins(other)).toThrow(ForbiddenException);
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

  it('lets only the owner have code read from the admin chat', async () => {
    await controller.ask('t1', { text: 'почему?' }, other);
    expect(topics.ask).toHaveBeenLastCalledWith('t1', 77, 'почему?', {
      canReadCode: false,
    });
    await controller.ask('t1', { text: 'почему?' }, owner);
    expect(topics.ask).toHaveBeenLastCalledWith('t1', 42, 'почему?', {
      canReadCode: true,
    });
  });

  it('maps topic errors to HTTP statuses', async () => {
    topics.ask.mockRejectedValueOnce(new TopicLimitError('limit'));
    await expect(
      controller.ask('t1', { text: 'x' }, owner),
    ).rejects.toMatchObject({ status: 429 });
    topics.ask.mockRejectedValueOnce(new TopicError('busy'));
    await expect(
      controller.ask('t1', { text: 'x' }, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    topics.ask.mockRejectedValueOnce(new Error('anthropic down'));
    await expect(
      controller.ask('t1', { text: 'x' }, owner),
    ).rejects.toMatchObject({ status: 503 });
  });
});
