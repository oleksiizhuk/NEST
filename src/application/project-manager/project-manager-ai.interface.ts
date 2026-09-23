export const PM_AI_SERVICE = 'PM_AI_SERVICE';

export interface PmTurn {
  userText: string;
  botResponse: string;
}

export interface PmRequest {
  brief: string;
  snapshot: string;
  history: PmTurn[];
  // Date, release countdown and the question; kept out of the cached prefix
  // so the cache survives from one day to the next
  question: string;
}

export interface IProjectManagerAiService {
  answer(request: PmRequest): Promise<string>;
  digest(request: Omit<PmRequest, 'history'>): Promise<string>;
}
