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

const TASK = { key: 'KAN-1', url: 'https://jira.example/browse/KAN-1' };

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

    await expect(service.generateReply('створи таску')).resolves.toBe(
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
      `Одну створив, решту окремо\n\n${TASK.key} — ${TASK.url}`,
    );

    expect(mockTaskTracker.createTask).toHaveBeenCalledTimes(1);
    expect(mockTaskTracker.createTask).toHaveBeenCalledWith('Перша', undefined);

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
    await expect(service.generateReply('створи таску')).resolves.toBe(
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

    await expect(service.generateReply('створи таску')).resolves.toBe(
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
      'Пофіксити цю з логіном',
      undefined,
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

    await expect(service.generateReply('онови KAN-12')).resolves.toBe(
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

    await expect(service.generateReply('закрий KAN-12')).resolves.toBe(
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
});
