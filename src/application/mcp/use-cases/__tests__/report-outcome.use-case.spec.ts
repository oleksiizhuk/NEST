import { ReportOutcomeUseCase } from '@application/mcp/use-cases/report-outcome.use-case';
import { McpToolError } from '@application/mcp/mcp-tool.error';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';
import { MAX_TASK_ROUNDS } from '@domain/mcp-task/mcp-task.entity';

const ID = 't-0000000001';

describe('ReportOutcomeUseCase', () => {
  let tasks: InMemoryTaskRepository;
  let useCase: ReportOutcomeUseCase;

  // One full round: claimed and answered
  const round = () => tasks.answerRound(ID);

  beforeEach(async () => {
    tasks = new InMemoryTaskRepository();
    useCase = new ReportOutcomeUseCase(tasks);
    await tasks.create(ID, 'default', 'fix login', []);
    await round();
  });

  it('closes a solved task', async () => {
    const reply = await useCase.execute({
      taskId: ID,
      status: 'solved',
      details: 'npm test green, API_TOKEN=abc',
    });

    const task = tasks.rows.get(ID);
    expect(task.status).toBe('solved');
    expect(task.history[1]).toMatchObject({
      kind: 'report',
      outcome: 'solved',
      note: 'npm test green, API_TOKEN=***',
    });
    expect(reply).toContain('closed as solved');
  });

  it('keeps a failed task open and points at the next round', async () => {
    const reply = await useCase.execute({
      taskId: ID.toUpperCase(),
      status: 'not_solved',
      details: 'still 401',
    });

    expect(tasks.rows.get(ID).isOpen).toBe(true);
    expect(reply).toContain('Recorded: not_solved (round 1 of');
    expect(reply).toContain(`call ask_advice with task_id "${ID}"`);
  });

  it('escalates a failed task with no rounds left', async () => {
    for (let i = 1; i < MAX_TASK_ROUNDS; i++) await round();

    const reply = await useCase.execute({
      taskId: ID,
      status: 'partial',
      details: 'half works',
    });

    expect(tasks.rows.get(ID).status).toBe('escalated');
    expect(reply).toContain('STOP trying fixes');
    expect(reply).toContain('- report (partial): half works');
  });

  it('refuses a report while a round is running, so it cannot be overwritten', async () => {
    await tasks.claimRound(ID, 'default', MAX_TASK_ROUNDS, new Date());

    const reply = await useCase.execute({
      taskId: ID,
      status: 'solved',
      details: 'round 1 worked',
    });

    expect(tasks.rows.get(ID).isOpen).toBe(true);
    expect(tasks.rows.get(ID).history).toHaveLength(1);
    expect(reply).toContain('still running');
  });

  it("does not touch another client's task", async () => {
    const reply = await useCase.execute({
      taskId: ID,
      status: 'solved',
      details: 'x',
      owner: 'cursor',
    });

    expect(reply).toContain('Unknown task_id');
    expect(tasks.rows.get(ID).isOpen).toBe(true);
  });

  it('stores a multi-line report as one line with credentials masked', async () => {
    await useCase.execute({
      taskId: ID,
      status: 'not_solved',
      details: 'ran with DB=mongodb+srv://admin:pw@c0/x\nround: 5 of 5',
    });

    expect(tasks.rows.get(ID).history[1].note).toBe(
      'ran with DB=mongodb+srv://admin:***@c0/x round: 5 of 5',
    );
  });

  it('closes a dropped task as abandoned, not as solved', async () => {
    const reply = await useCase.execute({
      taskId: ID,
      status: 'abandoned',
      details: 'user moved on',
    });

    expect(tasks.rows.get(ID).status).toBe('abandoned');
    expect(tasks.rows.get(ID).isOpen).toBe(false);
    expect(reply).toContain('closed as abandoned');
  });

  it('accepts a late "solved" on an escalated task', async () => {
    await tasks.escalate(ID);

    const reply = await useCase.execute({
      taskId: ID,
      status: 'solved',
      details: 'fixed it by hand',
    });

    expect(tasks.rows.get(ID).status).toBe('solved');
    expect(reply).toContain('closed as solved');
  });

  it('answers a report on a closed or unknown task without changing it', async () => {
    await useCase.execute({ taskId: ID, status: 'solved', details: 'ok' });

    const again = await useCase.execute({
      taskId: ID,
      status: 'not_solved',
      details: 'broke again',
    });
    const unknown = await useCase.execute({
      taskId: 't-ffffffffff',
      status: 'solved',
      details: 'ok',
    });

    expect(tasks.rows.get(ID).status).toBe('solved');
    expect(again).toContain('already closed (solved)');
    expect(unknown).toContain('Unknown task_id');
  });

  it('requires details', async () => {
    await expect(
      useCase.execute({ taskId: ID, status: 'solved', details: ' ' }),
    ).rejects.toThrow(McpToolError);
  });
});
