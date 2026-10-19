import {
  splitForTelegram,
  TelegramBotService,
} from '@infrastructure/telegram/telegram-bot.service';

// Telegram's hard limit is 4096; the splitter targets 4000
const LIMIT = 4000;

describe('splitForTelegram', () => {
  it('leaves a short reply as one message', () => {
    expect(splitForTelegram('коротко')).toEqual(['коротко']);
  });

  it('drops an empty reply rather than sending a blank message', () => {
    expect(splitForTelegram('   ')).toEqual([]);
  });

  it('splits a long reply into sendable chunks', () => {
    const chunks = splitForTelegram('а'.repeat(LIMIT * 2 + 500));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('cuts on a paragraph break when there is one', () => {
    const head = 'а'.repeat(LIMIT - 200);
    const tail = 'б'.repeat(500);

    const [first, second] = splitForTelegram(`${head}\n\n${tail}`);

    expect(first).toBe(head);
    expect(second).toBe(tail);
  });

  it('never cuts mid-word when a space is available', () => {
    const words = 'слово '.repeat(2000).trim();

    for (const chunk of splitForTelegram(words)) {
      expect(chunk.startsWith('лово')).toBe(false);
      expect(chunk.endsWith('сло')).toBe(false);
    }
  });

  it('keeps the whole text across the chunks', () => {
    const text = Array.from({ length: 600 }, (_, i) => `рядок ${i}`).join('\n');

    const joined = splitForTelegram(text).join('\n');

    expect(joined.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });
});

const mockApi = {
  getMe: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue(undefined),
  sendChatAction: jest.fn().mockResolvedValue(undefined),
  editMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
};
const mockBotCtor = jest.fn();
jest.mock('grammy', () => ({
  Bot: jest.fn().mockImplementation((token: string) => {
    mockBotCtor(token);
    if (!token) throw new Error('Empty token!');
    return {
      api: mockApi,
      on: jest.fn(),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
      isRunning: () => false,
    };
  }),
}));

const serviceWith = (token?: string) =>
  new TelegramBotService({ get: () => token } as any);

describe('TelegramBotService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('boots without TELEGRAM_TOKEN and creates no client until used', async () => {
    const service = serviceWith(undefined);
    expect(mockBotCtor).not.toHaveBeenCalled();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('sends a long reply as several messages through the Bot API', async () => {
    await serviceWith('1:abc').sendMessage(42, 'а'.repeat(LIMIT + 10));
    expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockApi.sendMessage.mock.calls[0][0]).toBe(42);
  });

  it('sends Jira keys as links and falls back to plain text if refused', async () => {
    const env: Record<string, string> = {
      TELEGRAM_TOKEN: '1:abc',
      JIRA_BASE_URL: 'https://example.atlassian.net/jira',
      PM_JIRA_PROJECTS: 'orv',
    };
    const service = new TelegramBotService({
      get: (k: string) => env[k],
    } as any);
    await service.sendMessage(42, 'Done ORV-7');
    expect(mockApi.sendMessage).toHaveBeenCalledWith(42, 'Done ORV-7', {
      entities: [
        {
          type: 'text_link',
          offset: 5,
          length: 5,
          url: 'https://example.atlassian.net/browse/ORV-7',
        },
      ],
    });
    mockApi.sendMessage.mockRejectedValueOnce(
      new Error("Bad Request: can't parse entities"),
    );
    await service.sendMessage(42, 'Done ORV-8');
    expect(mockApi.sendMessage).toHaveBeenLastCalledWith(42, 'Done ORV-8', {});
    // Any other failure is not hidden behind a resend
    mockApi.sendMessage.mockRejectedValueOnce(new Error('Forbidden: blocked'));
    await expect(service.sendMessage(42, 'ORV-9')).rejects.toThrow('blocked');
  });

  it('shows the typing indicator', async () => {
    await serviceWith('1:abc').sendTyping(42);
    expect(mockApi.sendChatAction).toHaveBeenCalledWith(42, 'typing');
  });

  it('caches getMe and retries after a failure', async () => {
    const service = serviceWith('1:abc');
    mockApi.getMe
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ id: 7, username: 'nest_bot' });

    await expect(service.getBotInfo()).rejects.toThrow('network');
    await expect(service.getBotInfo()).resolves.toEqual({
      id: 7,
      username: 'nest_bot',
    });
    await service.getBotInfo();
    expect(mockApi.getMe).toHaveBeenCalledTimes(2);
  });

  it('sends a checklist as one message and returns its id', async () => {
    const service = serviceWith('1:abc');
    mockApi.sendMessage.mockResolvedValueOnce({ message_id: 555 });
    const buttons = [[{ text: '⬜ Кнопка', data: 'ck:0a1b2c3d:t0' }]];
    await expect(service.sendWithButtons(42, 'Список', buttons)).resolves.toBe(
      555,
    );
    expect(mockApi.sendMessage).toHaveBeenCalledWith(42, 'Список', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬜ Кнопка', callback_data: 'ck:0a1b2c3d:t0' }],
        ],
      },
    });
    await expect(
      service.sendWithButtons(42, 'а'.repeat(4097), buttons),
    ).rejects.toThrow();
    expect(mockApi.sendMessage).toHaveBeenCalledTimes(1);

    await service.setButtons(42, 555, [[{ text: '✅ x', data: 'd' }]]);
    expect(mockApi.editMessageReplyMarkup).toHaveBeenCalledWith(42, 555, {
      reply_markup: {
        inline_keyboard: [[{ text: '✅ x', callback_data: 'd' }]],
      },
    });
  });
});
