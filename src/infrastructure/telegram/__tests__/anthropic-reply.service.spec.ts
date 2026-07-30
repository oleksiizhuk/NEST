import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { TASK_TRACKER_SERVICE } from '@application/telegram/task-tracker.service.interface';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

// Imported after the mock so the service picks up the stubbed SDK
import { AnthropicReplyService } from '@infrastructure/telegram/anthropic-reply.service';

const TASK = {
  key: 'KAN-1',
  url: 'https://jira.example/browse/KAN-1',
  status: 'Backlog',
};

const transitionUseResponse = (id: string, input: Record<string, unknown>) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'transition_jira_task', input }],
});

const updateUseResponse = (id: string, input: Record<string, unknown>) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'update_jira_task', input }],
});

const toolUseResponse = (id: string, summary = 'Полагодити кран') => ({
  stop_reason: 'tool_use',
  content: [
    {
      type: 'tool_use',
      id,
      name: 'create_jira_task',
      input: { summary },
    },
  ],
});

const textResponse = (text: string) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
});

// Last tool_result the model was handed back, i.e. the outcome of call N-1
const lastToolResults = (callIndex: number) => {
  const { messages } = mockCreate.mock.calls[callIndex][0];
  return messages[messages.length - 1].content;
};

describe('AnthropicReplyService', () => {
  let service: AnthropicReplyService;
  const mockTaskTracker = {
    createTask: jest.fn(),
    updateTask: jest.fn(),
    transitionTask: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnthropicReplyService,
        { provide: TASK_TRACKER_SERVICE, useValue: mockTaskTracker },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();
    service = module.get(AnthropicReplyService);
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockTaskTracker.createTask.mockResolvedValue(TASK);
    mockTaskTracker.updateTask.mockResolvedValue(TASK);
    mockTaskTracker.transitionTask.mockResolvedValue({
      ...TASK,
      status: 'Done',
    });
  });

  it('returns the text reply when no tool is used', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('Позич 300 грн'));

    await expect(service.generateReply('привіт')).resolves.toBe(
      'Позич 300 грн',
    );
    expect(mockTaskTracker.createTask).not.toHaveBeenCalled();
  });

  it('forbids parallel tool calls on every request', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ок'));

    await service.generateReply('привіт');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
      }),
    );
  });

  it('replays history as alternating turns before the new message', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ок'));

    await service.generateReply('третє', [
      { userText: 'перше', botResponse: 'відповідь 1' },
      { userText: 'друге', botResponse: 'відповідь 2' },
    ]);

    expect(mockCreate.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'перше' },
      { role: 'assistant', content: 'відповідь 1' },
      { role: 'user', content: 'друге' },
      { role: 'assistant', content: 'відповідь 2' },
      { role: 'user', content: 'третє' },
    ]);
  });

  it('creates a task and feeds the key back to the model', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('t1'))
      .mockResolvedValueOnce(textResponse('Створив KAN-1'));

    await expect(service.generateReply('створи таску')).resolves.toContain(
      'Створив KAN-1',
    );
    expect(mockTaskTracker.createTask).toHaveBeenCalledTimes(1);
    expect(lastToolResults(1)).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: `Created ${TASK.key}: ${TASK.url}`,
      },
    ]);
  });

  it('refuses a second task in the same request without hitting Jira', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('t1', 'Перша'))
      .mockResolvedValueOnce(toolUseResponse('t2', 'Друга'))
      .mockResolvedValueOnce(textResponse('Одну створив, решту окремо'));

    await expect(service.generateReply('створи дві таски')).resolves.toBe(
      [
        'Одну створив, решту окремо',
        '',
        `${TASK.key} — ${TASK.url}`,
        'Заголовок: Перша',
        'Тип: Task · Backlog',
        'Питань нема — усе було в повідомленні',
      ].join('\n'),
    );

    expect(mockTaskTracker.createTask).toHaveBeenCalledTimes(1);
    expect(mockTaskTracker.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Перша' }),
    );

    const [refusal] = lastToolResults(2);
    expect(refusal).toMatchObject({
      type: 'tool_result',
      tool_use_id: 't2',
      is_error: true,
    });
    expect(refusal.content).toContain(TASK.key);
  });

  it('allows a task again on the next user message', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('t1'))
      .mockResolvedValueOnce(textResponse('перша'))
      .mockResolvedValueOnce(toolUseResponse('t2'))
      .mockResolvedValueOnce(textResponse('друга'));

    await service.generateReply('створи таску');
    await service.generateReply('і ще одну');

    expect(mockTaskTracker.createTask).toHaveBeenCalledTimes(2);
  });

  it('reports a Jira failure back to the model as an error result', async () => {
    mockTaskTracker.createTask.mockRejectedValue(new Error('Jira 401'));
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('t1'))
      .mockResolvedValueOnce(textResponse('не вдалося'));

    await expect(service.generateReply('створи таску')).resolves.toBe(
      'не вдалося',
    );
    expect(lastToolResults(1)).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: 'Failed: Jira 401',
        is_error: true,
      },
    ]);
  });

  it('reports the created task even when the loop runs out of turns', async () => {
    mockCreate.mockResolvedValue(toolUseResponse('t1'));

    // Saying "failed" here would have the user create a duplicate
    await expect(service.generateReply('створи таску')).resolves.toContain(
      `${TASK.key} — ${TASK.url}`,
    );
    expect(mockTaskTracker.createTask).toHaveBeenCalledTimes(1);
  });

  it('falls back when the loop runs out with nothing created', async () => {
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'unknown_tool', input: {} },
      ],
    });

    await expect(service.generateReply('шось')).resolves.toBe(
      'Не вдалося завершити операцію 😢',
    );
  });

  it('joins every text block instead of only the first', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'перша частина' },
        { type: 'text', text: 'друга частина' },
      ],
    });

    await expect(service.generateReply('питання')).resolves.toBe(
      'перша частина\n\nдруга частина',
    );
  });

  it('falls back when the model returns no text at all', async () => {
    mockCreate.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] });

    await expect(service.generateReply('питання')).resolves.toBe(
      'Не вдалося завершити операцію 😢',
    );
  });

  it('leaves the reply alone when it already names the task', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('t1'))
      .mockResolvedValueOnce(textResponse(`Зробив ${TASK.key}, дивись сам`));

    await expect(service.generateReply('створи таску')).resolves.toContain(
      `Зробив ${TASK.key}, дивись сам`,
    );
  });

  it('strips profanity and trims the summary before it reaches Jira', async () => {
    mockCreate
      .mockResolvedValueOnce(
        toolUseResponse('t1', '  Пофіксити цю хуйню з\n\nлогіном  '),
      )
      .mockResolvedValueOnce(textResponse('ок'));

    await service.generateReply('створи таску');

    expect(mockTaskTracker.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Пофіксити цю з логіном' }),
    );
  });

  it('updates a task by key and cleans the new title', async () => {
    mockCreate
      .mockResolvedValueOnce(
        updateUseResponse('u1', {
          key: 'kan-12',
          summary: '  Новий\n\nзаголовок хуйня  ',
        }),
      )
      .mockResolvedValueOnce(textResponse('поправив'));

    await expect(service.generateReply('онови KAN-12')).resolves.toContain(
      'поправив',
    );
    expect(mockTaskTracker.updateTask).toHaveBeenCalledWith('KAN-12', {
      summary: 'Новий заголовок',
    });
  });

  it('sends only the fields the model actually changed', async () => {
    mockCreate
      .mockResolvedValueOnce(
        updateUseResponse('u1', { key: 'KAN-3', description: 'Новий опис' }),
      )
      .mockResolvedValueOnce(textResponse('ок'));

    await service.generateReply('онови опис');

    expect(mockTaskTracker.updateTask).toHaveBeenCalledWith('KAN-3', {
      description: 'Новий опис',
    });
  });

  it('refuses a made-up task key instead of calling Jira', async () => {
    mockCreate
      .mockResolvedValueOnce(
        updateUseResponse('u1', { key: 'та отой таск', summary: 'Щось' }),
      )
      .mockResolvedValueOnce(textResponse('який саме таск?'));

    await service.generateReply('онови таску');

    expect(mockTaskTracker.updateTask).not.toHaveBeenCalled();
    expect(lastToolResults(1)[0]).toMatchObject({ is_error: true });
  });

  it('refuses an update that changes nothing', async () => {
    mockCreate
      .mockResolvedValueOnce(updateUseResponse('u1', { key: 'KAN-12' }))
      .mockResolvedValueOnce(textResponse('а шо міняти?'));

    await service.generateReply('онови KAN-12');

    expect(mockTaskTracker.updateTask).not.toHaveBeenCalled();
    expect(lastToolResults(1)[0]).toMatchObject({ is_error: true });
  });

  it('moves a task to the requested status', async () => {
    mockCreate
      .mockResolvedValueOnce(
        transitionUseResponse('m1', { key: 'kan-12', status: 'done' }),
      )
      .mockResolvedValueOnce(textResponse('закрив'));

    await expect(service.generateReply('закрий KAN-12')).resolves.toContain(
      'закрив',
    );
    expect(mockTaskTracker.transitionTask).toHaveBeenCalledWith(
      'KAN-12',
      'done',
    );
    expect(lastToolResults(1)[0].content).toContain('Done');
  });

  it('hands the available statuses back when the target is unreachable', async () => {
    mockTaskTracker.transitionTask.mockRejectedValue(
      new Error(
        '"Done" is not available for KAN-12. Available now: In Progress',
      ),
    );
    mockCreate
      .mockResolvedValueOnce(
        transitionUseResponse('m1', { key: 'KAN-12', status: 'Done' }),
      )
      .mockResolvedValueOnce(textResponse('туди не можна'));

    await service.generateReply('закрий KAN-12');

    const [result] = lastToolResults(1);
    expect(result).toMatchObject({ is_error: true });
    expect(result.content).toContain('In Progress');
  });

  it('refuses to move a made-up key', async () => {
    mockCreate
      .mockResolvedValueOnce(
        transitionUseResponse('m1', { key: 'та отой', status: 'Done' }),
      )
      .mockResolvedValueOnce(textResponse('який таск?'));

    await service.generateReply('закрий таску');

    expect(mockTaskTracker.transitionTask).not.toHaveBeenCalled();
    expect(lastToolResults(1)[0]).toMatchObject({ is_error: true });
  });

  it('shows exactly what landed on the board', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'create_jira_task',
            input: {
              summary: 'Postpone icon replacement on mockups',
              description:
                'Context: design system is not ready.\n- OPEN: Which sprint?',
            },
          },
        ],
      })
      .mockResolvedValueOnce(textResponse('завів, гуляй'));

    const reply = await service.generateReply('створи таску');

    expect(reply).toBe(
      [
        'завів, гуляй',
        '',
        `${TASK.key} — ${TASK.url}`,
        'Заголовок: Postpone icon replacement on mockups',
        'Тип: Task · Backlog',
        'Треба уточнити:\n• Which sprint?',
      ].join('\n'),
    );
  });

  it('reports the receipt even when the model says nothing', async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse('t1', 'Fix the login flow'))
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] });

    const reply = await service.generateReply('створи таску');

    expect(reply).toBe(
      [
        `${TASK.key} — ${TASK.url}`,
        'Заголовок: Fix the login flow',
        'Тип: Task · Backlog',
        'Питань нема — усе було в повідомленні',
      ].join('\n'),
    );
  });

  it('lists only the fields an update actually changed', async () => {
    mockCreate
      .mockResolvedValueOnce(
        updateUseResponse('u1', { key: 'KAN-3', description: 'New wording' }),
      )
      .mockResolvedValueOnce(textResponse('поправив'));

    const reply = await service.generateReply('онови KAN-3');

    expect(reply).toContain('Новий опис: New wording');
    expect(reply).not.toContain('Новий заголовок');
  });

  it('reports the resulting status after a move', async () => {
    mockCreate
      .mockResolvedValueOnce(
        transitionUseResponse('m1', { key: 'KAN-12', status: 'Done' }),
      )
      .mockResolvedValueOnce(textResponse('закрив'));

    const reply = await service.generateReply('закрий KAN-12');

    expect(reply).toContain('Статус: Done');
  });

  it('keeps the description structure but flattens the summary', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'create_jira_task',
            input: {
              summary: 'Fix\nthe   login',
              description:
                'Context: users cannot log in.\n\nScope:\n- Fix the guard\n\nOpen questions:\n- OPEN: Which environments?',
              type: 'Bug',
              priority: 'High',
            },
          },
        ],
      })
      .mockResolvedValueOnce(textResponse('зробив'));

    await service.generateReply('заведи баг');

    expect(mockTaskTracker.createTask).toHaveBeenCalledWith({
      summary: 'Fix the login',
      description:
        'Context: users cannot log in.\n\nScope:\n- Fix the guard\n\nOpen questions:\n- OPEN: Which environments?',
      type: 'Bug',
      priority: 'High',
    });
  });

  it('pulls the open questions into the chat reply', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'create_jira_task',
            input: {
              summary: 'Add retries',
              description:
                'Scope:\n- Add retries\n\nOpen questions:\n- OPEN: How many attempts?\n- OPEN: What backoff?',
            },
          },
        ],
      })
      .mockResolvedValueOnce(textResponse('готово'));

    const reply = await service.generateReply('зроби таску на ретраї');

    expect(reply).toContain('Треба уточнити:');
    expect(reply).toContain('• How many attempts?');
    expect(reply).toContain('• What backoff?');
  });

  it('caches the static prefix', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('ок'));

    await service.generateReply('привіт');

    expect(mockCreate.mock.calls[0][0].system).toEqual([
      expect.objectContaining({ cache_control: { type: 'ephemeral' } }),
    ]);
  });

  it('reads open questions from an "Open:" section too', async () => {
    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'create_jira_task',
            input: {
              summary: 'Postpone icon replacement on mockups',
              description:
                'No icon component exists yet. Leaving the icons as they are.\n\nOpen:\n- Which mockups are affected?\n- What counts as the design system being ready?',
            },
          },
        ],
      })
      .mockResolvedValueOnce(textResponse('відклав'));

    const reply = await service.generateReply('відклади іконки');

    expect(reply).toContain('• Which mockups are affected?');
    expect(reply).toContain('• What counts as the design system being ready?');
  });
});
