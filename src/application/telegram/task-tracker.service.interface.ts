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

export interface IMovedTask extends ICreatedTask {
  status: string;
}

export interface ITaskTrackerService {
  createTask(summary: string, description?: string): Promise<ICreatedTask>;
  updateTask(key: string, changes: ITaskChanges): Promise<ICreatedTask>;
  // Rejects with the list of available statuses when the requested one is not
  // reachable from where the task currently sits
  transitionTask(key: string, status: string): Promise<IMovedTask>;
}
