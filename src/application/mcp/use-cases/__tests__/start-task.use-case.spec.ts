import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import { ICodeAssistantService } from '@application/mcp/code-assistant.service.interface';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';

describe('StartTaskUseCase', () => {
  let tasks: InMemoryTaskRepository;
  let assistant: jest.Mocked<ICodeAssistantService>;
  let useCase: StartTaskUseCase;

  beforeEach(() => {
    tasks = new InMemoryTaskRepository();
    assistant = {
      ask: jest.fn(),
      plan: jest
        .fn()
        .mockResolvedValue([
          'src/login.ts and its callers',
          'the 401 response body',
        ]),
    };
    useCase = new StartTaskUseCase(assistant, tasks);
  });

  it('opens a task with the checklist and tells the caller to gather it first', async () => {
    const reply = await useCase.execute({
      goal: '  Login returns 401 after refresh  ',
      context: ' LoginScreen.tsx ',
    });

    const [task] = [...tasks.rows.values()];
    expect(task.id).toMatch(/^t-[0-9a-f]{10}$/);
    expect(task.goal).toBe('Login returns 401 after refresh');
    expect(task.checklist).toEqual([
      'src/login.ts and its callers',
      'the 401 response body',
    ]);
    expect(assistant.plan).toHaveBeenCalledWith({
      goal: 'Login returns 401 after refresh',
      context: 'LoginScreen.tsx',
    });
    expect(reply).toContain(`Task ${task.id} started`);
    expect(reply).toContain('1. src/login.ts and its callers');
    expect(reply).toContain(`ask_advice with task_id "${task.id}"`);
  });

  it('reminds of earlier tasks still waiting for a report', async () => {
    await tasks.create('t-0000000001', 'old bug', []);
    await tasks.recordReply('t-0000000001', {
      at: new Date(),
      kind: 'answer',
      note: 'h',
    });
    await tasks.create('t-0000000002', 'still gathering', []);

    const reply = await useCase.execute({ goal: 'new bug' });

    expect(reply).toContain('- t-0000000001: old bug');
    expect(reply).not.toContain('still gathering');
  });

  it('rejects an empty goal', async () => {
    await expect(useCase.execute({ goal: '  ' })).rejects.toThrow(
      'goal must not be empty',
    );
    expect(assistant.plan).not.toHaveBeenCalled();
  });
});
