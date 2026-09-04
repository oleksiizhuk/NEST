export const CODE_ASSISTANT_SERVICE = 'CODE_ASSISTANT_SERVICE';

export interface IAskRequest {
  // The question or instruction
  prompt: string;
  // Optional material the answer should be grounded in: file contents,
  // a diff, an error log. Kept separate so the model can tell the
  // question apart from the code it is about.
  context?: string;
}

export interface ICodeAssistantService {
  ask(request: IAskRequest): Promise<string>;
}
