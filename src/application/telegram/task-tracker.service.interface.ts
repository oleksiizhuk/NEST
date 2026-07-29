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

export type TaskType = 'Task' | 'Bug' | 'Story';
// The KAN scheme, verified against the board: Blocker 1 · High 2 · Normal 3 · Low 4
export type TaskPriority = 'Blocker' | 'High' | 'Normal' | 'Low';

export interface INewTask {
  summary: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
}

export interface IMovedTask extends ICreatedTask {
  status: string;
}

export interface ITaskTrackerService {
  createTask(task: INewTask): Promise<ICreatedTask>;
  updateTask(key: string, changes: ITaskChanges): Promise<ICreatedTask>;
  // Rejects with the list of available statuses when the requested one is not
  // reachable from where the task currently sits
  transitionTask(key: string, status: string): Promise<IMovedTask>;
}
