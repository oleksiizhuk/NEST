import { Logger } from '@nestjs/common';
import { DryRunTaskTracker } from '@infrastructure/jira/dry-run-task-tracker';

describe('DryRunTaskTracker', () => {
  let tracker: DryRunTaskTracker;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    tracker = new DryRunTaskTracker();
  });

  it('hands back a key that cannot be mistaken for a real one', async () => {
    const task = await tracker.createTask({ summary: 'Fix the login flow' });

    expect(task.key).toBe('DRY-1');
    expect(task.url).toContain('тестовий режим');
    // Mirrors production, where a new task is moved to the backlog
    expect(task.status).toBe('Backlog');
  });

  it('numbers the keys so two tasks in a row stay apart', async () => {
    const first = await tracker.createTask({ summary: 'First' });
    const second = await tracker.createTask({ summary: 'Second' });

    expect([first.key, second.key]).toEqual(['DRY-1', 'DRY-2']);
  });

  it('echoes the key back for an update', async () => {
    const task = await tracker.updateTask('KAN-12', { summary: 'New title' });

    expect(task.key).toBe('KAN-12');
    expect(task.url).toContain('тестовий режим');
  });

  it('echoes the requested status for a move', async () => {
    const task = await tracker.transitionTask('KAN-12', 'Done');

    expect(task).toMatchObject({ key: 'KAN-12', status: 'Done' });
  });

  it('logs what would have been filed', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');

    await tracker.createTask({
      summary: 'Fix the login flow',
      description: 'Users cannot log in.',
    });

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Users cannot log in.'),
    );
  });
});
