import { AskClaudeUseCase } from '@application/mcp/use-cases/ask-claude.use-case';
import { ICodeAssistantService } from '@application/mcp/code-assistant.service.interface';

describe('AskClaudeUseCase', () => {
  const assistant: jest.Mocked<ICodeAssistantService> = {
    ask: jest.fn().mockResolvedValue('answer'),
  };
  const useCase = new AskClaudeUseCase(assistant);

  beforeEach(() => jest.clearAllMocks());

  it('forwards a trimmed prompt and context to the assistant', async () => {
    const result = await useCase.execute({
      prompt: '  why does this throw?  ',
      context: '\nconst x = null; x.y;\n',
    });

    expect(result).toBe('answer');
    expect(assistant.ask).toHaveBeenCalledWith({
      prompt: 'why does this throw?',
      context: 'const x = null; x.y;',
    });
  });

  it('drops an empty context instead of sending a blank one', async () => {
    await useCase.execute({ prompt: 'hi', context: '   ' });

    expect(assistant.ask).toHaveBeenCalledWith({
      prompt: 'hi',
      context: undefined,
    });
  });

  it('rejects an empty prompt without calling the assistant', async () => {
    await expect(useCase.execute({ prompt: '   ' })).rejects.toThrow(
      'prompt must not be empty',
    );
    expect(assistant.ask).not.toHaveBeenCalled();
  });
});
