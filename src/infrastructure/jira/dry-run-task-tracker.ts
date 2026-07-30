import { Injectable, Logger } from '@nestjs/common';
import {
  ICreatedTask,
  IMovedTask,
  INewTask,
  ITaskChanges,
  ITaskTrackerService,
} from '@application/telegram/task-tracker.service.interface';

// Stands in for JiraService when JIRA_DRY_RUN is on. Everything upstream — the
// prompt, the tool schemas, the model — runs for real; only the board is spared.
// The key and the URL say so themselves, so the receipt in the chat cannot be
// mistaken for a real ticket even at a glance.
const NOT_CREATED = 'нічого не створено (тестовий режим)';

@Injectable()
export class DryRunTaskTracker implements ITaskTrackerService {
  private readonly logger = new Logger(DryRunTaskTracker.name);
  private counter = 0;

  async createTask(task: INewTask): Promise<ICreatedTask> {
    const key = `DRY-${++this.counter}`;
    this.logger.log(
      `[dry run] create ${key}: ${JSON.stringify(task, null, 2)}`,
    );
    return { key, url: NOT_CREATED, status: 'Backlog' };
  }

  async updateTask(key: string, changes: ITaskChanges): Promise<ICreatedTask> {
    this.logger.log(
      `[dry run] update ${key}: ${JSON.stringify(changes, null, 2)}`,
    );
    return { key, url: NOT_CREATED };
  }

  async transitionTask(key: string, status: string): Promise<IMovedTask> {
    this.logger.log(`[dry run] transition ${key} -> ${status}`);
    return { key, url: NOT_CREATED, status };
  }
}
