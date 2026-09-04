import { Inject, Injectable } from '@nestjs/common';
import {
  CODE_ASSISTANT_SERVICE,
  IAskRequest,
  ICodeAssistantService,
} from '@application/mcp/code-assistant.service.interface';

// Answers a question from an MCP client (an IDE agent such as Kiro) with the
// configured code assistant. The transport is the controller's concern; the
// use case only owns what a valid request is.
@Injectable()
export class AskClaudeUseCase {
  constructor(
    @Inject(CODE_ASSISTANT_SERVICE)
    private readonly assistant: ICodeAssistantService,
  ) {}

  async execute(request: IAskRequest): Promise<string> {
    const prompt = (request.prompt ?? '').trim();
    if (!prompt) {
      throw new Error('prompt must not be empty');
    }
    const context = request.context?.trim() || undefined;

    return this.assistant.ask({ prompt, context });
  }
}
