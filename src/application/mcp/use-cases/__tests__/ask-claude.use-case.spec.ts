import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { ICodeAssistantService } from '@application/mcp/code-assistant.service.interface';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';
import { MAX_TASK_ROUNDS } from '@domain/mcp-task/mcp-task.entity';

describe('AskClaudeUseCase', () => {
  let tasks: InMemoryTaskRepository;
  let assistant: jest.Mocked<ICodeAssistantService>;
  let useCase: AskClaudeUseCase;

  beforeEach(() => {
    tasks = new InMemoryTaskRepository();
    assistant = {
      ask: jest.fn().mockResolvedValue({
        text: 'Use ?. here.\n\nHow to verify: npm test',
        needInfo: false,
        hypothesis: 'x is null on first render; guard it',
      }),
      plan: jest.fn(),
    };
    useCase = new AskClaudeUseCase(assistant, tasks);
  });

  it('opens a task when none is given and asks for a report after the answer', async () => {
    const reply = await useCase.execute({
      prompt: '  why does this throw?\nmore detail  ',
      context: '\nconst x = null; x.y;\n',
      model: 'sonnet',
    });

    const [task] = [...tasks.rows.values()];
    expect(task.goal).toBe('why does this throw?');
    expect(task.status).toBe('answered');
    expect(task.rounds).toBe(1);
    expect(task.history).toEqual([
      expect.objectContaining({
        kind: 'answer',
        note: 'x is null on first render; guard it',
      }),
    ]);
    expect(assistant.ask).toHaveBeenCalledWith({
      prompt: 'why does this throw?\nmore detail',
      context: 'const x = null; x.y;',
      model: 'sonnet',
      task: {
        goal: 'why does this throw?',
        checklist: [],
        history: [],
        round: 1,
        maxRounds: MAX_TASK_ROUNDS,
      },
    });
    expect(reply).toContain('Use ?. here.');
    expect(reply).toContain(
      `task_id: ${task.id} (round 1 of ${MAX_TASK_ROUNDS})`,
    );
    expect(reply).toContain(`report_outcome { task_id: "${task.id}"`);
  });

  it('keeps a request for more material on the task and points back at ask_advice', async () => {
    await tasks.create('t-0000000001', 'fix login', ['the error']);
    assistant.ask.mockResolvedValue({
      text: '1. Send src/auth.ts',
      needInfo: true,
    });

    const reply = await useCase.execute({
      prompt: 'fix it',
      taskId: 't-0000000001',
    });

    const task = tasks.rows.get('t-0000000001');
    expect(task.status).toBe('gathering');
    expect(task.history[0]).toMatchObject({
      kind: 'need_info',
      note: '1. Send src/auth.ts',
    });
    expect(reply).toContain(
      'call ask_advice again with task_id "t-0000000001"',
    );
    expect(reply).not.toContain('report_outcome');
  });

  it('passes earlier rounds to the assistant so a failed fix is not repeated', async () => {
    await tasks.create('t-0000000001', 'fix login', ['the error']);
    await useCase.execute({ prompt: 'a', taskId: 't-0000000001' });
    await tasks.report('t-0000000001', 'not_solved', {
      at: new Date(),
      kind: 'report',
      note: 'still 401',
      outcome: 'not_solved',
    });

    await useCase.execute({ prompt: 'b', taskId: 't-0000000001' });

    expect(assistant.ask.mock.calls[1][0].task).toMatchObject({
      round: 2,
      checklist: ['the error'],
      history: [
        { kind: 'answer' },
        { kind: 'report', outcome: 'not_solved', note: 'still 401' },
      ],
    });
  });

  it('escalates a task out of rounds without calling the model', async () => {
    await tasks.create('t-0000000001', 'fix login', []);
    for (let i = 0; i < MAX_TASK_ROUNDS; i++) {
      await useCase.execute({ prompt: 'again', taskId: 't-0000000001' });
    }
    assistant.ask.mockClear();

    const reply = await useCase.execute({
      prompt: 'again',
      taskId: 't-0000000001',
    });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(tasks.rows.get('t-0000000001').status).toBe('escalated');
    expect(reply).toContain('STOP trying fixes');
    expect(reply).toContain('Goal: fix login');
  });

  it('refuses an unknown or closed task without calling the model', async () => {
    await tasks.create('t-0000000002', 'done', []);
    await tasks.report('t-0000000002', 'solved', {
      at: new Date(),
      kind: 'report',
      note: 'ok',
      outcome: 'solved',
    });

    const unknown = await useCase.execute({
      prompt: 'a',
      taskId: 't-ffffffffff',
    });
    const closed = await useCase.execute({
      prompt: 'a',
      taskId: 't-0000000002',
    });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(unknown).toContain('Unknown task_id "t-ffffffffff"');
    expect(closed).toContain('already closed (solved)');
  });

  it('rejects an empty prompt without opening a task', async () => {
    await expect(useCase.execute({ prompt: '   ' })).rejects.toThrow(
      'prompt must not be empty',
    );
    expect(tasks.rows.size).toBe(0);
    expect(assistant.ask).not.toHaveBeenCalled();
  });
});
