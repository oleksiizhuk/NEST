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

  it('is a pass-through when MCP_DAILY_LIMIT is unset or not positive', async () => {
    const model = modelReturning(999);
    const guard = new McpDailyLimitGuard(configWith(undefined), model);
    await expect(guard.canActivate(toolCall)).resolves.toBe(true);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();

    const zero = new McpDailyLimitGuard(configWith('0'), modelReturning(999));
    await expect(zero.canActivate(toolCall)).resolves.toBe(true);
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

  it('counts every paid call in a batch, and an unnamed call as paid', async () => {
    const model = modelReturning(3);
    const guard = new McpDailyLimitGuard(configWith('5'), model);
    await guard.canActivate(
      ctxWith([
        { method: 'tools/call', params: { name: 'ask_advice' } },
        { method: 'tools/call', params: { name: 'start_task' } },
        { method: 'tools/call' },
        { method: 'tools/list' },
      ]),
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      { $inc: { count: 3 } },
      { upsert: true, new: true },
    );
  });

  it('allows a tools/call at or below the limit and counts it', async () => {
    const model = modelReturning(5);
    const guard = new McpDailyLimitGuard(configWith('5'), model);
    await expect(guard.canActivate(toolCall)).resolves.toBe(true);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { day: expect.any(String) },
      { $inc: { count: 1 } },
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
