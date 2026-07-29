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
  const mockTaskTracker = { createTask: jest.fn() };

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
      'Одну створив, решту окремо',
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

  it('gives up after the iteration cap', async () => {
    mockCreate.mockResolvedValue(toolUseResponse('t1'));

    await expect(service.generateReply('створи таску')).resolves.toBe(
      'Не вдалося завершити операцію 😢',
    );
    // First call creates the task, every later one is refused
    expect(mockTaskTracker.createTask).toHaveBeenCalledTimes(1);
  });
});
