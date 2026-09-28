import { ListOpenTasksUseCase } from '@application/mcp/use-cases/list-open-tasks.use-case';
import { InMemoryTaskRepository } from '@application/mcp/__tests__/in-memory-task.repository';

describe('ListOpenTasksUseCase', () => {
  it('says so when nothing is open', async () => {
    const useCase = new ListOpenTasksUseCase(new InMemoryTaskRepository());
    expect(await useCase.execute()).toBe('No open tasks.');
  });

  it("lists the caller's open tasks, flagging ones waiting for a report and stale ones", async () => {
    const tasks = new InMemoryTaskRepository();
    tasks.now = () => new Date('2026-09-01T00:00:00Z');
    await tasks.create('t-0000000001', 'kiro', 'old bug', []);
    await tasks.answerRound('t-0000000001');
    await tasks.create('t-0000000002', 'kiro', 'closed one', []);
    await tasks.report('t-0000000002', 'kiro', 'solved', {
      at: new Date(),
      kind: 'report',
      note: 'ok',
      outcome: 'solved',
    });
    await tasks.create('t-0000000003', 'cursor', 'not mine', []);

    const reply = await new ListOpenTasksUseCase(tasks).execute(
      'kiro',
      new Date('2026-09-03T00:00:00Z'),
    );

    expect(reply).toContain(
      '- t-0000000001: "old bug" [WAITING FOR YOUR REPORT, round 1 of 5, no activity for over a day]',
    );
    expect(reply).not.toContain('closed one');
    expect(reply).not.toContain('not mine');
  });
});
