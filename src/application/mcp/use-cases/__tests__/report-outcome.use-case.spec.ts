import { ReportOutcomeUseCase } from '@application/mcp/use-cases/report-outcome.use-case';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';
import { MAX_TASK_ROUNDS } from '@domain/mcp-task/mcp-task.entity';

describe('ReportOutcomeUseCase', () => {
  let tasks: InMemoryTaskRepository;
  let useCase: ReportOutcomeUseCase;

  beforeEach(async () => {
    tasks = new InMemoryTaskRepository();
    useCase = new ReportOutcomeUseCase(tasks);
    await tasks.create('t-0000000001', 'fix login', []);
    await tasks.claimRound('t-0000000001', MAX_TASK_ROUNDS);
  });

  it('closes a solved task', async () => {
    const reply = await useCase.execute({
      taskId: 't-0000000001',
      status: 'solved',
      details: 'npm test green',
    });

    const task = tasks.rows.get('t-0000000001');
    expect(task.status).toBe('solved');
    expect(task.history[0]).toMatchObject({
      kind: 'report',
      outcome: 'solved',
      note: 'npm test green',
    });
    expect(reply).toContain('closed as solved');
  });

  it('keeps a failed task open and points at the next round', async () => {
    const reply = await useCase.execute({
      taskId: 't-0000000001',
      status: 'not_solved',
      details: 'still 401',
    });

    expect(tasks.rows.get('t-0000000001').isOpen).toBe(true);
    expect(reply).toContain('Recorded: not_solved (round 1 of');
    expect(reply).toContain('call ask_advice with task_id "t-0000000001"');
  });

  it('escalates a failed task that has no rounds left', async () => {
    for (let i = 1; i < MAX_TASK_ROUNDS; i++) {
      await tasks.claimRound('t-0000000001', MAX_TASK_ROUNDS);
    }

    const reply = await useCase.execute({
      taskId: 't-0000000001',
      status: 'partial',
      details: 'half works',
    });

    expect(tasks.rows.get('t-0000000001').status).toBe('escalated');
    expect(reply).toContain('STOP trying fixes');
    expect(reply).toContain('- report (partial): half works');
  });

  it('answers a report on a closed or unknown task without changing it', async () => {
    await useCase.execute({
      taskId: 't-0000000001',
      status: 'solved',
      details: 'ok',
    });

    const again = await useCase.execute({
      taskId: 't-0000000001',
      status: 'not_solved',
      details: 'broke again',
    });
    const unknown = await useCase.execute({
      taskId: 't-ffffffffff',
      status: 'solved',
      details: 'ok',
    });

    expect(tasks.rows.get('t-0000000001').status).toBe('solved');
    expect(again).toContain('already closed (solved)');
    expect(unknown).toContain('Unknown task_id');
  });

  it('requires details', async () => {
    await expect(
      useCase.execute({
        taskId: 't-0000000001',
        status: 'solved',
        details: ' ',
      }),
    ).rejects.toThrow('details must not be empty');
  });
});
