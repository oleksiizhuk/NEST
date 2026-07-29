export const TASK_TRACKER_SERVICE = 'TASK_TRACKER_SERVICE';

export interface ICreatedTask {
  key: string;
  url: string;
}

// At least one field must be set — an empty update is rejected
export interface ITaskChanges {
  summary?: string;
  description?: string;
}

export interface ITaskTrackerService {
  createTask(summary: string, description?: string): Promise<ICreatedTask>;
  updateTask(key: string, changes: ITaskChanges): Promise<ICreatedTask>;
}
