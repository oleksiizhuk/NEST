import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpDailyLimitGuard } from '@infrastructure/http/mcp/guards/mcp-daily-limit.guard';
import { IMcpUsageRepository } from '@domain/mcp-task/mcp-usage.repository.interface';

const config = (values: Record<string, string> = {}) =>
  ({ get: (key: string) => values[key] } as unknown as ConfigService);

// A counter that answers `count` after the increment
const counterAt = (count: number) => {
  const repo = {
    increment: jest.fn().mockResolvedValue(count),
    giveBack: jest.fn().mockResolvedValue(undefined),
    usageOn: jest.fn(),
  };
  return repo as typeof repo & IMcpUsageRepository;
};

// Minimal ExecutionContext carrying a JSON-RPC body on the HTTP request.
const ctxWith = (body: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext);

const call = (name?: string, model?: string) => ({
  method: 'tools/call',
  params: { name, arguments: model ? { model } : {} },
});
const toolCall = ctxWith(call('ask_advice'));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FREE = /^\d{4}-\d{2}-\d{2}:free$/;
const REFUSED = /^\d{4}-\d{2}-\d{2}:refused$/;

describe('McpDailyLimitGuard', () => {
  it('is a pass-through without a usage repository or with the budget off', async () => {
    await expect(
      new McpDailyLimitGuard(config(), 5, undefined).canActivate(toolCall),
    ).resolves.toBe(true);

    const repo = counterAt(999);
    await expect(
      new McpDailyLimitGuard(config(), 0, repo).canActivate(toolCall),
    ).resolves.toBe(true);
    expect(repo.increment).not.toHaveBeenCalled();
  });

  it('does not count handshake / non-tools-call messages', async () => {
    const repo = counterAt(1);
    const guard = new McpDailyLimitGuard(config(), 5, repo);
    await expect(
      guard.canActivate(ctxWith({ method: 'tools/list' })),
    ).resolves.toBe(true);
    expect(repo.increment).not.toHaveBeenCalled();
  });

  it('allows a call at the limit and counts its units', async () => {
    const repo = counterAt(5);
    await expect(
      new McpDailyLimitGuard(config(), 5, repo).canActivate(toolCall),
    ).resolves.toBe(true);
    // ask_advice without a model: opus by default, 2 units
    expect(repo.increment).toHaveBeenCalledWith(expect.stringMatching(DAY), 2);
    expect(repo.giveBack).not.toHaveBeenCalled();
  });

  it('refuses past the limit, gives the units back and keeps them as refused', async () => {
    const repo = counterAt(6);
    await expect(
      new McpDailyLimitGuard(config(), 5, repo).canActivate(
        ctxWith(call('ask_advice', 'fable')),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(repo.giveBack).toHaveBeenCalledWith(expect.stringMatching(DAY), 4);
    expect(repo.increment).toHaveBeenLastCalledWith(
      expect.stringMatching(REFUSED),
      4,
    );
  });

  it('counts free tools on their own, looser cap and gives back a refused free call', async () => {
    const repo = counterAt(1);
    await new McpDailyLimitGuard(config(), 5, repo).canActivate(
      ctxWith(call('report_outcome')),
    );
    expect(repo.increment).toHaveBeenCalledWith(expect.stringMatching(FREE), 1);

    const busy = counterAt(51);
    await expect(
      new McpDailyLimitGuard(config(), 5, busy).canActivate(
        ctxWith(call('list_open_tasks')),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(busy.giveBack).toHaveBeenCalledWith(expect.stringMatching(FREE), 1);
    expect(busy.increment).toHaveBeenLastCalledWith(
      expect.stringMatching(/:refusedFree$/),
      1,
    );
  });

  it('refuses a batch bigger than the whole day without touching the counter', async () => {
    const repo = counterAt(1);
    await expect(
      new McpDailyLimitGuard(config(), 5, repo).canActivate(
        ctxWith([call('ask_advice', 'fable'), call('ask_advice', 'fable')]),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(repo.increment).not.toHaveBeenCalled();
    expect(repo.giveBack).not.toHaveBeenCalled();
  });

  it('still refuses with 429 when recording the refusal fails', async () => {
    const repo = counterAt(6);
    repo.increment
      .mockResolvedValueOnce(9)
      .mockRejectedValueOnce(new Error('mongo down'));
    const refusal = new McpDailyLimitGuard(config(), 5, repo)
      .canActivate(toolCall)
      .catch((e: HttpException) => e.getStatus());
    await expect(refusal).resolves.toBe(429);
  });

  it('a batch refused on the paid budget gives back its free calls too', async () => {
    const repo = counterAt(6);
    repo.increment
      .mockResolvedValueOnce(1) // free: fine
      .mockResolvedValueOnce(9); // paid: over 5
    await expect(
      new McpDailyLimitGuard(config(), 5, repo).canActivate(
        ctxWith([call('report_outcome'), call('ask_advice', 'sonnet')]),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(repo.giveBack).toHaveBeenCalledWith(expect.stringMatching(FREE), 1);
    expect(repo.giveBack).toHaveBeenCalledWith(expect.stringMatching(DAY), 1);
  });

  it('counts a batch in cost units: by model, planning cheap, unknown dear', async () => {
    const repo = counterAt(3);
    await new McpDailyLimitGuard(config(), 50, repo).canActivate(
      ctxWith([
        call('ask_advice', 'sonnet'), // 1
        call('ask_advice'), // opus by default: 2
        call('ask_advice', 'fable'), // 4
        call('start_task'), // 1
        call(), // unknown: 4
        { method: 'tools/list' },
      ]),
    );
    expect(repo.increment).toHaveBeenCalledTimes(1);
    expect(repo.increment).toHaveBeenCalledWith(expect.stringMatching(DAY), 12);
  });

  it('prices a call without a model at MCP_AI_MODEL, a raw id as the dearest', async () => {
    for (const [configured, units] of [
      ['fable', 4],
      ['sonnet', 1],
      ['claude-some-future-model', 4],
    ] as const) {
      const repo = counterAt(1);
      await new McpDailyLimitGuard(
        config({ MCP_AI_MODEL: configured }),
        50,
        repo,
      ).canActivate(toolCall);
      expect(repo.increment).toHaveBeenCalledWith(
        expect.stringMatching(DAY),
        units,
      );
    }
  });
});
