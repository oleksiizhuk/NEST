import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { TelegramMessage } from '@domain/telegram/telegram-message.entity';
import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';

const OWNER = 1;
const PM_GROUP = -100;
const OTHER_GROUP = -200;
const BOT = { id: 42, username: 'nest_bot' };

const group = (chatId: number, text: string, fromId = 7) => ({
  chatId,
  chatType: 'supergroup',
  chatTitle: 'Team',
  text,
  from: { id: fromId, username: 'dev', firstName: 'Dev', lastName: null },
});

describe('HandleTelegramMessageUseCase — project-manager mode', () => {
  const telegram = {
    sendMessage: jest.fn(),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    getBotInfo: jest.fn().mockResolvedValue(BOT),
  };
  const persona = {
    generateReply: jest.fn().mockResolvedValue('persona reply'),
  };
  const repo = { save: jest.fn(), findByChatId: jest.fn() };
  const pmAnswer = { execute: jest.fn().mockResolvedValue('AT RISK: …') };
  const pmRefresh = {
    execute: jest.fn().mockResolvedValue(
      new ProjectSnapshot('s', new Date(), [
        {
          source: 'issues',
          ok: true,
          fetchedAt: new Date(),
          text: 'x',
          error: null,
        },
      ]),
    ),
  };
  const registry = {
    isEnabled: jest.fn().mockResolvedValue(false),
    enable: jest.fn(),
    disable: jest.fn(),
    digestChats: jest.fn(),
  };
  let useCase: HandleTelegramMessageUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findByChatId.mockResolvedValue([]);
    useCase = new HandleTelegramMessageUseCase(
      telegram,
      persona,
      repo as any,
      {
        ownerId: OWNER,
        mode: 'webhook',
        webhookSecret: 's',
        historySince: null,
      },
      {
        chatIds: [PM_GROUP, OWNER],
        digestChatId: null,
        releaseDate: '2026-09-30',
        projectBrief: '',
        maxSnapshotAgeHours: 30,
      },
      pmAnswer as any,
      pmRefresh as any,
      registry,
    );
  });

  it('answers as project manager in a listed group and logs the turn as pm', async () => {
    await useCase.execute(group(PM_GROUP, '@nest_bot как дела?'));
    expect(pmAnswer.execute).toHaveBeenCalledWith('Dev @dev: как дела?', []);
    expect(persona.generateReply).not.toHaveBeenCalled();
    expect(telegram.sendMessage).toHaveBeenCalledWith(PM_GROUP, 'AT RISK: …');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'pm' }),
    );
  });

  it('never gives project data to a group that is not listed', async () => {
    await useCase.execute(group(OTHER_GROUP, '@nest_bot как дела по релизу?'));
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(pmRefresh.execute).not.toHaveBeenCalled();
    expect(persona.generateReply).toHaveBeenCalled();
  });

  it('still needs a mention or reply in a listed group', async () => {
    await useCase.execute(group(PM_GROUP, 'просто болтаем'));
    expect(pmAnswer.execute).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('turns /status into the status question', async () => {
    await useCase.execute({
      ...group(OWNER, '/status', OWNER),
      chatType: 'private',
    });
    expect(pmAnswer.execute.mock.calls[0][0]).toMatch(/How are we doing\?/);
  });

  it('lets only the owner force a refresh', async () => {
    await useCase.execute(group(PM_GROUP, '/refresh@nest_bot'));
    expect(pmRefresh.execute).not.toHaveBeenCalled();

    await useCase.execute(group(PM_GROUP, '/refresh@nest_bot', OWNER));
    expect(pmRefresh.execute).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(
      PM_GROUP,
      'Данные обновлены: issues ok',
    );
  });

  it('replays only pm turns as history, and keeps pm turns out of the persona', async () => {
    const log = (mode: string | null, text: string) =>
      new TelegramMessage(
        'id',
        new Date(),
        7,
        'dev',
        'Dev',
        null,
        PM_GROUP,
        'supergroup',
        'Team',
        text,
        `re: ${text}`,
        mode,
      );
    repo.findByChatId.mockResolvedValue([
      log('pm', 'pm question'),
      log(null, 'joke'),
    ]);

    await useCase.execute(group(PM_GROUP, '@nest_bot и что дальше?'));
    expect(pmAnswer.execute.mock.calls[0][1]).toEqual([
      { userText: 'Dev @dev: pm question', botResponse: 're: pm question' },
    ]);

    await useCase.execute(group(OTHER_GROUP, '@nest_bot привет'));
    const personaHistory = persona.generateReply.mock.calls[0][1];
    expect(personaHistory.map((t: { userText: string }) => t.userText)).toEqual(
      ['Dev @dev: joke'],
    );
  });

  it('lets the owner switch a group on with /pm_on, without an @mention', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_on', OWNER));
    expect(registry.enable).toHaveBeenCalledWith(OTHER_GROUP, 'Team');
    expect(telegram.sendMessage.mock.calls[0][1]).toMatch(/включён/);
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('ignores /pm_on from anyone but the owner, silently', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_on@nest_bot'));
    expect(registry.enable).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('ignores commands addressed to another bot', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_on@other_bot', OWNER));
    expect(registry.enable).not.toHaveBeenCalled();
  });

  it('answers as project manager in a group switched on at runtime', async () => {
    registry.isEnabled.mockResolvedValue(true);
    await useCase.execute(group(OTHER_GROUP, '/status'));
    expect(pmAnswer.execute).toHaveBeenCalled();
    expect(persona.generateReply).not.toHaveBeenCalled();
  });

  it('switches a group off with /pm_off', async () => {
    await useCase.execute(group(OTHER_GROUP, '/pm_off', OWNER));
    expect(registry.disable).toHaveBeenCalledWith(OTHER_GROUP);
  });
});
