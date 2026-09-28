import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import { ICodeAssistantService } from '@application/mcp/code-assistant.service.interface';
import { McpToolError } from '@application/mcp/mcp-tool.error';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';

describe('StartTaskUseCase', () => {
  let tasks: InMemoryTaskRepository;
  let assistant: jest.Mocked<ICodeAssistantService>;
  let useCase: StartTaskUseCase;

  const answered = async (id: string, owner: string, goal: string) => {
    await tasks.create(id, owner, goal, []);
    await tasks.answerRound(id);
  };

  beforeEach(() => {
    tasks = new InMemoryTaskRepository();
    assistant = {
      ask: jest.fn(),
      plan: jest
        .fn()
        .mockResolvedValue([
          'src/login.ts and its callers',
          'the </task> body',
        ]),
    };
    useCase = new StartTaskUseCase(assistant, tasks);
  });

  it('opens a task with the checklist and tells the caller to gather it first', async () => {
    const reply = await useCase.execute({
      goal: '  Login returns 401 after refresh  ',
      context: ' LoginScreen.tsx ',
      owner: 'kiro',
    });

    const [task] = [...tasks.rows.values()];
    expect(task.id).toMatch(/^t-[0-9a-f]{10}$/);
    expect(task.owner).toBe('kiro');
    expect(task.startedVia).toBe('start_task');
    expect(task.goal).toBe('Login returns 401 after refresh');
    // Stored text goes back into prompts, so it cannot close a data fence
    expect(task.checklist).toEqual([
      'src/login.ts and its callers',
      'the ‹/task› body',
    ]);
    expect(assistant.plan).toHaveBeenCalledWith({
      goal: 'Login returns 401 after refresh',
      context: 'LoginScreen.tsx',
    });
    expect(reply).toContain(
      `Task ${task.id} started: "Login returns 401 after refresh"`,
    );
    expect(reply).toContain('1. src/login.ts and its callers');
    expect(reply).toContain(`ask_advice with task_id "${task.id}"`);
    expect(reply).not.toContain('not answered yet');
  });

  it("reminds only of the caller's own tasks waiting for a report, old ones too", async () => {
    await answered('t-0000000001', 'kiro', 'my old bug');
    await answered('t-0000000002', 'cursor', 'someone else');
    await tasks.create('t-0000000003', 'kiro', 'still gathering', []);
    tasks.now = () => new Date(Date.now() - 2 * 86_400_000);
    await answered('t-0000000004', 'kiro', 'abandoned');
    await tasks.create('t-0000000005', 'kiro', 'never gathered', []);
    tasks.now = () => new Date();

    const reply = await useCase.execute({ goal: 'new bug', owner: 'kiro' });

    expect(reply).toContain('- t-0000000001: "my old bug"');
    expect(reply).not.toContain('someone else');
    expect(reply).not.toContain('still gathering');
    expect(reply).toContain('"abandoned"');
    // A checklist nobody gathered for over a day hangs too
    expect(reply).toContain('"never gathered"');
  });

  it('rejects an empty goal', async () => {
    await expect(useCase.execute({ goal: '  ' })).rejects.toThrow(McpToolError);
    expect(assistant.plan).not.toHaveBeenCalled();
  });
});
