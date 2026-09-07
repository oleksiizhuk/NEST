export const CODE_ASSISTANT_SERVICE = 'CODE_ASSISTANT_SERVICE';

// Short model names an IDE can pick per call. The infrastructure service maps
// them to concrete Anthropic model ids, so ids can move to a new generation
// without every client config changing.
export const ASSISTANT_MODELS = ['opus', 'sonnet', 'fable'] as const;
export type AssistantModel = (typeof ASSISTANT_MODELS)[number];
export const DEFAULT_ASSISTANT_MODEL: AssistantModel = 'opus';

export interface IAskRequest {
  // The question or instruction
  prompt: string;
  // Optional material the answer should be grounded in: file contents,
  // a diff, an error log. Kept separate so the model can tell the
  // question apart from the code it is about.
  context?: string;
  // Which model answers this call; omitted = the configured default
  model?: AssistantModel;
}

export interface ICodeAssistantService {
  ask(request: IAskRequest): Promise<string>;
}
