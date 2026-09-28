import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { McpDailyLimitGuard } from '@infrastructure/http/mcp/guards/mcp-daily-limit.guard';
import { McpUsageDocument } from '@infrastructure/database/schemas/mcp-usage.schema';

const configWith = (limit?: string): ConfigService =>
  ({
    get: (key: string) => (key === 'MCP_DAILY_LIMIT' ? limit : undefined),
  } as unknown as ConfigService);

const modelReturning = (count: number) =>
  ({
    findOneAndUpdate: jest.fn().mockResolvedValue({ count }),
  } as unknown as Model<McpUsageDocument>);

// Minimal ExecutionContext carrying a JSON-RPC body on the HTTP request.
const ctxWith = (body: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  } as unknown as ExecutionContext);

const toolCall = ctxWith({
  method: 'tools/call',
  params: { name: 'ask_advice' },
});
const handshake = ctxWith({ method: 'tools/list' });

describe('McpDailyLimitGuard', () => {
  it('is a pass-through when no Mongo model is available', async () => {
    const guard = new McpDailyLimitGuard(configWith('5'), undefined);
    await expect(guard.canActivate(toolCall)).resolves.toBe(true);
  });

  it('applies a default cap when MCP_DAILY_LIMIT is unset, and none at 0', async () => {
    const unset = new McpDailyLimitGuard(
      configWith(undefined),
      modelReturning(200),
    );
    await expect(unset.canActivate(toolCall)).resolves.toBe(true);
    const over = new McpDailyLimitGuard(
      configWith(undefined),
      modelReturning(201),
    );
    await expect(over.canActivate(toolCall)).rejects.toBeInstanceOf(
      HttpException,
    );

    const model = modelReturning(999);
    const zero = new McpDailyLimitGuard(configWith('0'), model);
    await expect(zero.canActivate(toolCall)).resolves.toBe(true);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not count handshake / non-tools-call messages', async () => {
    const model = modelReturning(1);
    const guard = new McpDailyLimitGuard(configWith('5'), model);
    await expect(guard.canActivate(handshake)).resolves.toBe(true);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('counts tools that never call the model on their own, looser cap', async () => {
    const model = modelReturning(1);
    const guard = new McpDailyLimitGuard(configWith('5'), model);
    await guard.canActivate(
      ctxWith({ method: 'tools/call', params: { name: 'report_outcome' } }),
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}:free$/) },
      { $inc: { count: 1 } },
      { upsert: true, new: true },
    );

    const busy = new McpDailyLimitGuard(configWith('5'), modelReturning(51));
    await expect(
      busy.canActivate(
        ctxWith({ method: 'tools/call', params: { name: 'list_open_tasks' } }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('counts a batch in cost units: by model, planning cheap, unknown dear', async () => {
    const model = modelReturning(3);
    const guard = new McpDailyLimitGuard(configWith('50'), model);
    const call = (name?: string, model?: string) => ({
      method: 'tools/call',
      params: { name, arguments: model ? { model } : {} },
    });
    await guard.canActivate(
      ctxWith([
        call('ask_advice', 'sonnet'), // 1
        call('ask_advice'), // opus by default: 2
        call('ask_advice', 'fable'), // 4
        call('start_task'), // 1
        call(), // unknown: 4
        { method: 'tools/list' },
      ]),
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      { $inc: { count: 12 } },
      { upsert: true, new: true },
    );
  });

  it('prices a call without a model at MCP_AI_MODEL, a raw id as the dearest', async () => {
    for (const [configured, units] of [
      ['fable', 4],
      ['sonnet', 1],
      ['claude-some-future-model', 4],
    ] as const) {
      const model = modelReturning(1);
      const config = {
        get: (key: string) =>
          ({ MCP_DAILY_LIMIT: '50', MCP_AI_MODEL: configured }[key]),
      } as unknown as ConfigService;
      await new McpDailyLimitGuard(config, model).canActivate(toolCall);
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { day: expect.any(String) },
        { $inc: { count: units } },
        { upsert: true, new: true },
      );
    }
  });

  it('reads a fractional or negative limit as a typo, never as off', async () => {
    for (const value of ['0.5', '-3']) {
      const guard = new McpDailyLimitGuard(
        configWith(value),
        modelReturning(250),
      );
      await expect(guard.canActivate(toolCall)).rejects.toBeInstanceOf(
        HttpException,
      );
    }
  });

  it('allows a tools/call at or below the limit and counts it', async () => {
    const model = modelReturning(5);
    const guard = new McpDailyLimitGuard(configWith('5'), model);
    await expect(guard.canActivate(toolCall)).resolves.toBe(true);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { day: expect.any(String) },
      { $inc: { count: 2 } },
      { upsert: true, new: true },
    );
  });

  it('rejects a tools/call once the counter passes the limit', async () => {
    const guard = new McpDailyLimitGuard(configWith('5'), modelReturning(6));
    await expect(guard.canActivate(toolCall)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('retries once on a duplicate-key race and then counts the call', async () => {
    const findOneAndUpdate = jest
      .fn()
      .mockRejectedValueOnce({ code: 11000 })
      .mockResolvedValueOnce({ count: 1 });
    const model = {
      findOneAndUpdate,
    } as unknown as Model<McpUsageDocument>;
    const guard = new McpDailyLimitGuard(configWith('5'), model);

    await expect(guard.canActivate(toolCall)).resolves.toBe(true);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});
