import { ToolSpec } from '@application/project-manager/tools/pm-toolbox';

export const PM_AI_SERVICE = 'PM_AI_SERVICE';

// What the model service returns when it could not produce an answer
export const PM_UNAVAILABLE_REPLY =
  'Не получилось подготовить ответ — попробуйте ещё раз чуть позже.';

export interface PmTurn {
  userText: string;
  botResponse: string;
}

export interface PmTools {
  specs: ToolSpec[];
  run(name: string, input: Record<string, unknown>): Promise<string>;
  // Called when a tool timed out and when the answer is final: tool work
  // still running in the background must not store anything afterwards
  close?(): void;
}

export interface PmRequest {
  brief: string;
  // Codebase maps and other long-lived reference text
  knowledge: string;
  snapshot: string;
  history: PmTurn[];
  // Date, release countdown and the question; kept out of the cached prefix
  // so the cache survives from one day to the next
  question: string;
  // Absent: a single call with no tools (the digest)
  tools?: PmTools;
  // Epoch ms by which the final answer must exist
  deadline?: number;
  // Called once per answer with what it cost, success or not
  onUsage?: (usage: PmUsage) => void;
}

export interface PmUsage {
  model: string;
  iterations: number;
  tools: string[];
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  ms: number;
}

export interface IProjectManagerAiService {
  answer(request: PmRequest): Promise<string>;
  // history: at most the previous digest, so the verdict stays consistent
  digest(
    request: Omit<PmRequest, 'history' | 'tools'> & { history?: PmTurn[] },
  ): Promise<string>;
}
