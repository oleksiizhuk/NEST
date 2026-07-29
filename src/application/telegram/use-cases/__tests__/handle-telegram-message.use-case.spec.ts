import { Test, TestingModule } from '@nestjs/testing';
import { HandleTelegramMessageUseCase } from '@application/telegram/use-cases/handle-telegram-message.use-case';
import { TELEGRAM_GATEWAY } from '@application/telegram/telegram.gateway.interface';
import { AI_REPLY_SERVICE } from '@application/telegram/ai-reply.service.interface';
import { TELEGRAM_CONFIG } from '@application/telegram/telegram.config.interface';
import { TELEGRAM_MESSAGE_REPOSITORY } from '@domain/telegram/telegram-message.repository.interface';
import { REPLY_IMAGE_RENDERER } from '@application/telegram/reply-image.renderer.interface';
import { IncomingTelegramMessage } from '@application/telegram/incoming-telegram-message';

const OWNER_ID = 1;
const ALLOWED_CHAT_ID = -100;
const BOT = { id: 42, username: 'test_bot' };

const privateMessage = (
  overrides: Partial<IncomingTelegramMessage> = {},
): IncomingTelegramMessage => ({
  chatId: OWNER_ID,
  chatType: 'private',
  chatTitle: null,
  text: 'Hello',
  from: { id: OWNER_ID, username: 'owner', firstName: 'O', lastName: null },
  ...overrides,
});

const groupMessage = (
  overrides: Partial<IncomingTelegramMessage> = {},
): IncomingTelegramMessage => ({
  chatId: ALLOWED_CHAT_ID,
  chatType: 'supergroup',
  chatTitle: 'Chat',
  text: 'Hello',
  from: { id: 7, username: 'member', firstName: 'M', lastName: null },
  ...overrides,
});

describe('HandleTelegramMessageUseCase', () => {
  let useCase: HandleTelegramMessageUseCase;
  const mockGateway = {
    sendMessage: jest.fn(),
    sendPhoto: jest.fn(),
    sendTyping: jest.fn(),
    getBotInfo: jest.fn(),
  };
  const mockAiReply = { generateReply: jest.fn() };
  const mockRepository = { save: jest.fn(), findByChatId: jest.fn() };
  const mockImageRenderer = { render: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandleTelegramMessageUseCase,
        { provide: TELEGRAM_GATEWAY, useValue: mockGateway },
        { provide: AI_REPLY_SERVICE, useValue: mockAiReply },
        { provide: TELEGRAM_MESSAGE_REPOSITORY, useValue: mockRepository },
        { provide: REPLY_IMAGE_RENDERER, useValue: mockImageRenderer },
        {
          provide: TELEGRAM_CONFIG,
          useValue: {
            ownerId: OWNER_ID,
            allowedChatId: ALLOWED_CHAT_ID,
            mode: 'polling',
            webhookSecret: 'secret',
          },
        },
      ],
    }).compile();
    useCase = module.get(HandleTelegramMessageUseCase);
    jest.clearAllMocks();
    mockGateway.getBotInfo.mockResolvedValue(BOT);
    mockGateway.sendMessage.mockResolvedValue(undefined);
    mockGateway.sendTyping.mockResolvedValue(undefined);
    mockAiReply.generateReply.mockResolvedValue('Sarcastic reply');
    mockRepository.save.mockResolvedValue(undefined);
    mockRepository.findByChatId.mockResolvedValue([]);
    mockGateway.sendPhoto.mockResolvedValue(undefined);
    // Plain text unless a test opts into the rendered image
    mockImageRenderer.render.mockResolvedValue(null);
  });

  it('ignores private message from non-owner', async () => {
    await useCase.execute(
      privateMessage({
        from: { id: 999, username: null, firstName: null, lastName: null },
      }),
    );
    expect(mockGateway.sendMessage).not.toHaveBeenCalled();
    expect(mockAiReply.generateReply).not.toHaveBeenCalled();
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('replies to owner in private chat and saves log', async () => {
    await useCase.execute(privateMessage());
    expect(mockGateway.sendTyping).toHaveBeenCalledWith(OWNER_ID);
    expect(mockAiReply.generateReply).toHaveBeenCalledWith('Hello', []);
    expect(mockGateway.sendMessage).toHaveBeenCalledWith(
      OWNER_ID,
      'Sarcastic reply',
    );
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWNER_ID,
        chatId: OWNER_ID,
        text: 'Hello',
        botResponse: 'Sarcastic reply',
      }),
    );
  });

  it('ignores message in a non-allowed group', async () => {
    await useCase.execute(groupMessage({ chatId: -555 }));
    expect(mockGateway.sendMessage).not.toHaveBeenCalled();
    expect(mockAiReply.generateReply).not.toHaveBeenCalled();
  });

  it('ignores allowed-group message without mention or reply', async () => {
    await useCase.execute(groupMessage());
    expect(mockGateway.sendMessage).not.toHaveBeenCalled();
    expect(mockAiReply.generateReply).not.toHaveBeenCalled();
  });

  it('responds to mention in allowed group with mention stripped', async () => {
    await useCase.execute(groupMessage({ text: '@test_bot how are you?' }));
    expect(mockAiReply.generateReply).toHaveBeenCalledWith('how are you?', []);
    expect(mockGateway.sendMessage).toHaveBeenCalledWith(
      ALLOWED_CHAT_ID,
      'Sarcastic reply',
    );
  });

  it('responds when message is a reply to the bot', async () => {
    await useCase.execute(groupMessage({ replyToBotId: BOT.id }));
    expect(mockAiReply.generateReply).toHaveBeenCalledWith('Hello', []);
    expect(mockGateway.sendMessage).toHaveBeenCalledWith(
      ALLOWED_CHAT_ID,
      'Sarcastic reply',
    );
  });

  it('ignores message without text', async () => {
    await useCase.execute(privateMessage({ text: null }));
    expect(mockGateway.getBotInfo).not.toHaveBeenCalled();
    expect(mockGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('passes the last exchanges as context, oldest first', async () => {
    // Repository returns newest first
    mockRepository.findByChatId.mockResolvedValue([
      { text: 'друге питання', botResponse: 'друга відповідь' },
      { text: 'перше питання', botResponse: 'перша відповідь' },
    ]);

    await useCase.execute(privateMessage({ text: 'третє питання' }));

    expect(mockRepository.findByChatId).toHaveBeenCalledWith(OWNER_ID, 10);
    expect(mockAiReply.generateReply).toHaveBeenCalledWith('третє питання', [
      { userText: 'перше питання', botResponse: 'перша відповідь' },
      { userText: 'друге питання', botResponse: 'друга відповідь' },
    ]);
  });

  it('drops failed turns from the context', async () => {
    mockRepository.findByChatId.mockResolvedValue([
      { text: 'впало', botResponse: 'ERROR: api down' },
      { text: 'без відповіді', botResponse: null },
      { text: null, botResponse: 'осиротіла відповідь' },
      { text: 'нормальне', botResponse: 'нормальна відповідь' },
    ]);

    await useCase.execute(privateMessage());

    expect(mockAiReply.generateReply).toHaveBeenCalledWith('Hello', [
      { userText: 'нормальне', botResponse: 'нормальна відповідь' },
    ]);
  });

  it('still replies when history cannot be loaded', async () => {
    mockRepository.findByChatId.mockRejectedValue(new Error('mongo down'));

    await useCase.execute(privateMessage());

    expect(mockAiReply.generateReply).toHaveBeenCalledWith('Hello', []);
    expect(mockGateway.sendMessage).toHaveBeenCalledWith(
      OWNER_ID,
      'Sarcastic reply',
    );
  });

  it('sends the rendered image with links kept in the caption', async () => {
    const png = Buffer.from('png');
    mockImageRenderer.render.mockResolvedValue(png);
    mockAiReply.generateReply.mockResolvedValue(
      'Зробив KAN-12: https://jira.example/browse/KAN-12',
    );

    await useCase.execute(privateMessage());

    expect(mockGateway.sendPhoto).toHaveBeenCalledWith(
      OWNER_ID,
      png,
      'https://jira.example/browse/KAN-12',
    );
    expect(mockGateway.sendMessage).not.toHaveBeenCalled();
    // The log keeps the text, not the picture
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        botResponse: 'Зробив KAN-12: https://jira.example/browse/KAN-12',
      }),
    );
  });

  it('sends a photo without caption when the reply has no links', async () => {
    mockImageRenderer.render.mockResolvedValue(Buffer.from('png'));

    await useCase.execute(privateMessage());

    expect(mockGateway.sendPhoto).toHaveBeenCalledWith(
      OWNER_ID,
      expect.any(Buffer),
      undefined,
    );
  });

  it('falls back to text when the photo upload fails', async () => {
    mockImageRenderer.render.mockResolvedValue(Buffer.from('png'));
    mockGateway.sendPhoto.mockRejectedValue(new Error('upload failed'));

    await useCase.execute(privateMessage());

    expect(mockGateway.sendMessage).toHaveBeenCalledWith(
      OWNER_ID,
      'Sarcastic reply',
    );
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ botResponse: 'Sarcastic reply' }),
    );
  });

  it('sends fallback and saves ERROR log when AI fails', async () => {
    mockAiReply.generateReply.mockRejectedValue(new Error('api down'));
    await useCase.execute(privateMessage());
    expect(mockGateway.sendMessage).toHaveBeenCalledWith(
      OWNER_ID,
      'Что-то пошло не так 😢',
    );
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ botResponse: 'ERROR: api down' }),
    );
  });
});
