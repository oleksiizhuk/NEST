export const TASK_TRACKER_SERVICE = 'TASK_TRACKER_SERVICE';

export interface ICreatedTask {
  key: string;
  url: string;
}

export interface ITaskTrackerService {
  createTask(summary: string, description?: string): Promise<ICreatedTask>;
}
