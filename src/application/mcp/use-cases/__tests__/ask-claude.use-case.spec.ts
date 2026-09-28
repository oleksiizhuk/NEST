import {
  AskClaudeUseCase,
  THIN_CONTEXT_CHARS,
} from '@application/mcp/use-cases/ask-claude.use-case';
import { StartTaskUseCase } from '@application/mcp/use-cases/start-task.use-case';
import { ICodeAssistantService } from '@application/mcp/code-assistant.service.interface';
import { McpToolError } from '@application/mcp/mcp-tool.error';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';
import { MAX_TASK_ROUNDS } from '@domain/mcp-task/mcp-task.entity';

const CODE = 'x'.repeat(THIN_CONTEXT_CHARS);
const ID = 't-00000000aa';

describe('AskClaudeUseCase', () => {
  let tasks: InMemoryTaskRepository;
  let assistant: jest.Mocked<ICodeAssistantService>;
  let useCase: AskClaudeUseCase;

  const answer = {
    text: 'Use ?. here.\n\nHow to verify: npm test',
    needInfo: false,
    hypothesis: 'x is null on first render; guard it',
  };
  const report = (outcome: 'solved' | 'not_solved') =>
    tasks.report(ID, 'default', outcome, {
      at: new Date(),
      kind: 'report',
      note: 'r',
      outcome,
    });

  beforeEach(async () => {
    tasks = new InMemoryTaskRepository();
    assistant = {
      ask: jest.fn().mockResolvedValue(answer),
      plan: jest.fn().mockResolvedValue(['the failing code']),
    };
    useCase = new AskClaudeUseCase(
      assistant,
      tasks,
      new StartTaskUseCase(assistant, tasks),
    );
    await tasks.create(ID, 'default', 'fix login', ['the error']);
  });

  it('gives a bare question without a task the checklist instead of an answer', async () => {
    const reply = await useCase.execute({
      prompt: 'why does login fail?',
      context: 'short',
    });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(assistant.plan).toHaveBeenCalledWith({
      goal: 'why does login fail?',
      context: 'short',
    });
    expect(reply).toContain('Your question is not answered yet');
    expect(reply).toContain('1. the failing code');
    expect(reply).toMatch(/ask_advice with task_id "t-[0-9a-f]{10}"/);
  });

  it('opens a task for a question with code and asks for a report after the answer', async () => {
    const reply = await useCase.execute({
      prompt: '  why does this throw?\nmore detail  ',
      context: CODE,
      model: 'sonnet',
      owner: 'kiro',
    });

    const task = [...tasks.rows.values()].find((t) => t.id !== ID);
    expect(task).toMatchObject({
      owner: 'kiro',
      goal: 'why does this throw?',
      status: 'answered',
      rounds: 1,
      inFlightSince: null,
    });
    expect(task.history).toEqual([
      expect.objectContaining({
        kind: 'answer',
        note: 'x is null on first render; guard it',
      }),
    ]);
    expect(assistant.ask).toHaveBeenCalledWith({
      prompt: 'why does this throw?\nmore detail',
      context: CODE,
      model: 'sonnet',
      task: {
        goal: 'why does this throw?',
        checklist: [],
        history: [],
        round: 1,
        maxRounds: MAX_TASK_ROUNDS,
        unreported: false,
      },
    });
    expect(reply).toContain('Use ?. here.');
    expect(reply).toContain(
      `task_id: ${task.id} (round 1 of ${MAX_TASK_ROUNDS})`,
    );
    expect(reply).toContain(`report_outcome { task_id: "${task.id}"`);
  });

  it('lists other unreported tasks under an answer to a task it opened itself', async () => {
    await tasks.answerRound(ID);

    const reply = await useCase.execute({ prompt: 'new bug', context: CODE });

    expect(reply).toContain(`- ${ID}: "fix login"`);
    const followUp = await useCase.execute({ prompt: 'b', taskId: ID });
    expect(followUp).not.toContain('Your other open tasks');
  });

  it('warns on the last round that a failure goes to a person', async () => {
    for (let i = 1; i < MAX_TASK_ROUNDS; i++) {
      await useCase.execute({ prompt: 'a', taskId: ID });
      await report('not_solved');
    }

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(reply).toContain('This was the last round');
  });

  it('answers from the real state when a parallel call beat the escalation', async () => {
    for (let i = 0; i < MAX_TASK_ROUNDS; i++) {
      await useCase.execute({ prompt: 'a', taskId: ID });
    }
    await report('not_solved');
    jest.spyOn(tasks, 'escalate').mockImplementation(async () => {
      await report('solved');
      return false;
    });

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(reply).toContain('already closed (solved)');
    expect(reply).not.toContain('STOP');
  });

  it('masks credentials in a goal taken from the question', async () => {
    await useCase.execute({
      prompt: 'Why does AWS_SECRET_KEY=abc123 fail <b>',
      context: CODE,
    });

    const task = [...tasks.rows.values()].find((t) => t.id !== ID);
    expect(task.goal).toBe('Why does AWS_SECRET_KEY=*** fail ‹b›');
  });

  it('keeps a request for material as one short line and points back at ask_advice', async () => {
    assistant.ask.mockResolvedValue({
      text: '1. Send src/auth.ts\n2. Run npm test\n' + 'more '.repeat(100),
      needInfo: true,
    });

    const reply = await useCase.execute({
      prompt: 'fix it',
      taskId: ` ${ID.toUpperCase()} `,
    });

    const task = tasks.rows.get(ID);
    expect(task.status).toBe('gathering');
    expect(task.history[0].kind).toBe('need_info');
    expect(task.history[0].note).toMatch(
      /^1\. Send src\/auth\.ts 2\. Run npm test (more )+mor?e?…$/,
    );
    expect(task.history[0].note.length).toBeLessThanOrEqual(300);
    expect(reply).toContain(`call ask_advice again with task_id "${ID}"`);
    expect(reply).not.toContain('report_outcome');
  });

  it('on the last round, a request for material says to report and hand over', async () => {
    for (let i = 1; i < MAX_TASK_ROUNDS; i++) {
      await useCase.execute({ prompt: 'a', taskId: ID });
      await report('not_solved');
    }
    assistant.ask.mockResolvedValue({ text: '1. more', needInfo: true });

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(assistant.ask.mock.calls[MAX_TASK_ROUNDS - 1][0].task.round).toBe(
      MAX_TASK_ROUNDS,
    );
    expect(reply).toContain('this was the last round');
  });

  it('passes earlier rounds on, and flags an answer that was never reported', async () => {
    await useCase.execute({ prompt: 'a', taskId: ID });
    const reply = await useCase.execute({ prompt: 'b', taskId: ID });

    expect(assistant.ask.mock.calls[1][0].task).toMatchObject({
      round: 2,
      checklist: ['the error'],
      unreported: true,
      history: [{ kind: 'answer' }],
    });
    expect(reply).toContain('You did not report on the previous answer');
  });

  it('gives the round back and returns the task_id when the model call fails', async () => {
    assistant.ask.mockRejectedValue(new Error('529 overloaded'));

    const error = await useCase
      .execute({ prompt: 'a', taskId: ID })
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(McpToolError);
    expect((error as Error).message).toContain(`task_id "${ID}"`);
    expect((error as Error & { cause: Error }).cause.message).toBe(
      '529 overloaded',
    );
    expect(tasks.rows.get(ID)).toMatchObject({
      rounds: 0,
      failures: 1,
      inFlightSince: null,
    });
  });

  it('gives the round back when the model produced no answer', async () => {
    assistant.ask.mockResolvedValue({
      text: 'Claude declined to answer this request.',
      needInfo: false,
      noAnswer: true,
    });

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(tasks.rows.get(ID)).toMatchObject({
      rounds: 0,
      failures: 1,
      history: [],
    });
    expect(reply).toContain('not counted as a round; failed attempts 1 of 3');
  });

  it('answers code pasted into the prompt instead of sending the checklist', async () => {
    const reply = await useCase.execute({
      prompt: `why does this throw?\n${CODE}`,
    });

    expect(assistant.plan).not.toHaveBeenCalled();
    expect(assistant.ask).toHaveBeenCalled();
    expect(reply).toContain('Use ?. here.');
  });

  it('still returns a paid answer when recording it fails', async () => {
    jest.spyOn(tasks, 'recordReply').mockRejectedValue(new Error('db down'));

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(reply).toContain('Use ?. here.');
    expect(reply).toContain(`report_outcome { task_id: "${ID}"`);
  });

  it('still names the task when giving a round back fails', async () => {
    jest.spyOn(tasks, 'releaseRound').mockRejectedValue(new Error('db down'));
    assistant.ask.mockResolvedValue({
      text: 'declined',
      needInfo: false,
      noAnswer: true,
    });

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(reply).toContain(`task_id "${ID}"`);
  });

  it('on the last failed attempt, says to report and hand over, not to retry', async () => {
    assistant.ask.mockRejectedValue(new Error('529'));
    const errors: string[] = [];
    for (let i = 0; i < 3; i++) {
      errors.push(
        await useCase
          .execute({ prompt: 'a', taskId: ID })
          .catch((e: Error) => e.message),
      );
    }

    expect(errors[0]).toContain('failed attempt 1 of 3');
    expect(errors[0]).toContain('call ask_advice again');
    expect(errors[2]).toContain('no attempts are left');
    expect(errors[2]).not.toContain('call ask_advice again');
  });

  it('out of attempts with an unreported answer, asks for the report without claiming rounds ran out', async () => {
    await useCase.execute({ prompt: 'a', taskId: ID });
    assistant.ask.mockRejectedValue(new Error('529'));
    for (let i = 0; i < 3; i++) {
      await useCase.execute({ prompt: 'a', taskId: ID }).catch(() => undefined);
    }

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(reply).toContain('has had 3 failed attempts');
    expect(reply).not.toContain('rounds');
    expect(tasks.rows.get(ID).isOpen).toBe(true);
  });

  it('escalates a task after too many failed attempts', async () => {
    assistant.ask.mockRejectedValue(new Error('529'));
    for (let i = 0; i < 3; i++) {
      await useCase.execute({ prompt: 'a', taskId: ID }).catch(() => undefined);
    }
    assistant.ask.mockClear();

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(tasks.rows.get(ID).status).toBe('escalated');
    expect(reply).toContain('STOP trying fixes');
  });

  it('takes over a round whose function died without counting another', async () => {
    await tasks.claimRound(ID, 'default', MAX_TASK_ROUNDS, new Date(0));

    await useCase.execute({ prompt: 'a', taskId: ID });

    expect(tasks.rows.get(ID)).toMatchObject({
      rounds: 1,
      status: 'answered',
      inFlightSince: null,
    });
  });

  it("does not run a round on another client's task", async () => {
    const reply = await useCase.execute({
      prompt: 'a',
      taskId: ID,
      owner: 'cursor',
    });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(reply).toContain('Unknown task_id');
  });

  it('refuses a second call while a round is running', async () => {
    await tasks.claimRound(ID, 'default', MAX_TASK_ROUNDS, new Date());

    const reply = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(reply).toContain('still running');
  });

  it('out of rounds, asks for the report first and escalates only after it', async () => {
    for (let i = 0; i < MAX_TASK_ROUNDS; i++) {
      await useCase.execute({ prompt: 'again', taskId: ID });
    }
    assistant.ask.mockClear();

    const first = await useCase.execute({ prompt: 'again', taskId: ID });
    expect(first).toContain('First apply the last answer');
    expect(tasks.rows.get(ID).isOpen).toBe(true);

    await report('not_solved');
    const second = await useCase.execute({ prompt: 'again', taskId: ID });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(tasks.rows.get(ID).status).toBe('escalated');
    expect(second).toContain('STOP trying fixes');
    expect(second).toContain('Goal: "fix login"');
  });

  it('refuses an unknown or closed task without calling the model', async () => {
    await report('solved');

    const unknown = await useCase.execute({
      prompt: 'a',
      taskId: 't-ffffffffff',
    });
    const closed = await useCase.execute({ prompt: 'a', taskId: ID });

    expect(assistant.ask).not.toHaveBeenCalled();
    expect(unknown).toContain('Unknown task_id "t-ffffffffff"');
    expect(closed).toContain('already closed (solved)');
  });

  it('rejects an empty prompt without opening a task', async () => {
    await expect(useCase.execute({ prompt: '   ' })).rejects.toThrow(
      McpToolError,
    );
    expect(tasks.rows.size).toBe(1);
  });
});
