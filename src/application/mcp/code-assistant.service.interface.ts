import type {
  McpOutcome,
  McpTaskEventKind,
} from '@domain/mcp-task/mcp-task.entity';

export const CODE_ASSISTANT_SERVICE = 'CODE_ASSISTANT_SERVICE';

// Short model names an IDE can pick per call. The infrastructure service maps
// them to concrete Anthropic model ids, so ids can move to a new generation
// without every client config changing.
export const ASSISTANT_MODELS = ['opus', 'sonnet', 'fable'] as const;
export type AssistantModel = (typeof ASSISTANT_MODELS)[number];
export const DEFAULT_ASSISTANT_MODEL: AssistantModel = 'opus';

// The task a question belongs to, so the answer can ask for what is missing
// and not repeat a fix that was already reported as not working
export interface IAskTask {
  goal: string;
  checklist: string[];
  history: { kind: McpTaskEventKind; note: string; outcome?: McpOutcome }[];
  round: number;
  maxRounds: number;
}

export interface IAskRequest {
  // The question or instruction
  prompt: string;
  // Optional material the answer should be grounded in: file contents,
  // a diff, an error log. Kept separate so the model can tell the
  // question apart from the code it is about.
  context?: string;
  // Which model answers this call; omitted = the configured default
  model?: AssistantModel;
  task?: IAskTask;
}

export interface IAskResult {
  text: string;
  // The reply asks for more material instead of answering
  needInfo: boolean;
  // One line: the cause being fixed and the fix, kept on the task
  hypothesis?: string;
}

export interface IPlanRequest {
  goal: string;
  context?: string;
}

export interface ICodeAssistantService {
  ask(request: IAskRequest): Promise<IAskResult>;
  // What to collect before the goal can be solved reliably: a short list
  plan(request: IPlanRequest): Promise<string[]>;
}
