import { ListOpenTasksUseCase } from '@application/mcp/use-cases/list-open-tasks.use-case';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';

describe('ListOpenTasksUseCase', () => {
  it('says so when nothing is open', async () => {
    const useCase = new ListOpenTasksUseCase(new InMemoryTaskRepository());
    expect(await useCase.execute()).toBe('No open tasks.');
  });

  it('lists open tasks, flags the ones waiting for a report and stale ones', async () => {
    const tasks = new InMemoryTaskRepository();
    tasks.now = () => new Date('2026-09-01T00:00:00Z');
    await tasks.create('t-0000000001', 'old bug', []);
    await tasks.recordReply('t-0000000001', {
      at: new Date(),
      kind: 'answer',
      note: 'h',
    });
    await tasks.create('t-0000000002', 'closed one', []);
    await tasks.report('t-0000000002', 'solved', {
      at: new Date(),
      kind: 'report',
      note: 'ok',
      outcome: 'solved',
    });

    const reply = await new ListOpenTasksUseCase(tasks).execute(
      new Date('2026-09-03T00:00:00Z'),
    );

    expect(reply).toContain(
      '- t-0000000001: old bug [WAITING FOR YOUR REPORT, round 0 of 5, no activity for over a day]',
    );
    expect(reply).not.toContain('closed one');
  });
});
