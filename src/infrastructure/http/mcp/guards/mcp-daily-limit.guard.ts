import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { FREE_TOOLS } from '@infrastructure/mcp/mcp-server.factory';
import { AssistantModel } from '@application/mcp/code-assistant.service.interface';
import {
  FREE_CALLS_PER_PAID,
  MCP_DAILY_BUDGET,
  usageDay,
  usageKey,
} from '@application/mcp/mcp-budget';
import {
  IMcpUsageRepository,
  MCP_USAGE_REPOSITORY,
} from '@domain/mcp-task/mcp-usage.repository.interface';

// The daily cap is in cost units, not calls, so it bounds spend: a call
// weighs what its model costs. start_task plans on sonnet. An unknown tool
// or model weighs the most — better one unit too many than a way around.
// Keyed by the models the tools accept: a new model needs a price here
const MODEL_UNITS: Record<AssistantModel, number> = {
  sonnet: 1,
  opus: 2,
  fable: 4,
};
const unitsOf = (model: string): number | undefined =>
  MODEL_UNITS[model as AssistantModel];
const MAX_UNITS = MODEL_UNITS.fable;

// A leaked MCP_TOKEN would otherwise buy unlimited paid model calls (a
// financial DoS). This caps cost units per UTC day with a shared Mongo
// counter, incremented atomically so concurrent serverless invocations
// still count. The budget (MCP_DAILY_BUDGET) is 0 when switched off.
// Without a usage repository (unit tests without a database) it passes.
@Injectable()
export class McpDailyLimitGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Inject(MCP_DAILY_BUDGET)
    private readonly limit: number,
    @Optional()
    @Inject(MCP_USAGE_REPOSITORY)
    private readonly usage?: IMcpUsageRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { limit, usage } = this;
    if (!usage || limit === 0) {
      return true; // cap switched off with MCP_DAILY_LIMIT=0
    }

    // Only tool calls that reach the model count toward the limit. In
    // stateless Streamable HTTP the handshake (initialize, tools/list) and
    // notifications are each their own POST; charging them would make the
    // effective cap a fraction of MCP_DAILY_LIMIT. A JSON-RPC batch counts
    // every call in it. Free tools (report_outcome, list_open_tasks) only
    // touch Mongo and get their own, looser cap.
    const { paid, free } = McpDailyLimitGuard.toolCalls(
      context,
      this.defaultModelUnits(),
    );
    // Counted before the call, on purpose: each attempt reaches the paid API,
    // so a hard DoS cap must count attempts (including failures and client
    // retries), not only completions. A retried model call can bill twice.
    // A refused call spends nothing: what it counted is given back, and paid
    // units are kept apart as refused, so the stats tell spend from
    // hammering.
    const day = usageDay(new Date());
    // A batch bigger than a whole day can never pass: refuse it before it
    // touches the counter, so it cannot lock the day out for others
    if (paid > limit || free > limit * FREE_CALLS_PER_PAID) {
      throw new HttpException(
        `This request asks for more than the whole daily /mcp budget of ${limit} units.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const freeKey = usageKey(day, 'free');
    const paidKey = usageKey(day, 'paid');
    // Free first: a batch refused on the free cap must not use paid quota
    if (free) {
      const freeLimit = limit * FREE_CALLS_PER_PAID;
      if ((await usage.increment(freeKey, free)) > freeLimit) {
        await usage.giveBack(freeKey, free);
        await usage
          .increment(usageKey(day, 'refusedFree'), free)
          .catch(() => undefined);
        throw new HttpException(
          `Daily /mcp limit of ${freeLimit} task calls reached. Try again tomorrow (UTC).`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    if (paid && (await usage.increment(paidKey, paid)) > limit) {
      await usage.giveBack(paidKey, paid);
      // The batch's free calls never run either
      if (free) await usage.giveBack(freeKey, free);
      await usage
        .increment(usageKey(day, 'refused'), paid)
        .catch(() => undefined);
      throw new HttpException(
        `Daily /mcp budget of ${limit} units reached (sonnet 1, opus 2, ` +
          'fable 4 per call). Try again tomorrow (UTC).',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  // A call without `model` runs on MCP_AI_MODEL (opus when unset); a raw
  // model id there is priced as the dearest, since its cost is unknown
  private defaultModelUnits(): number {
    const configured = this.configService.get<string>('MCP_AI_MODEL')?.trim();
    if (!configured) return MODEL_UNITS.opus;
    return unitsOf(configured) ?? MAX_UNITS;
  }

  private static units(
    tool: string,
    model: unknown,
    defaultUnits: number,
  ): number {
    if (tool === 'start_task') return MODEL_UNITS.sonnet;
    if (tool !== 'ask_advice') return MAX_UNITS;
    if (model === undefined) return defaultUnits;
    return unitsOf(String(model)) ?? MAX_UNITS;
  }

  private static toolCalls(
    context: ExecutionContext,
    defaultUnits: number,
  ): {
    paid: number;
    free: number;
  } {
    const body = context.switchToHttp().getRequest<Request>().body as unknown;
    // A JSON-RPC request may arrive alone or batched in an array.
    const messages = Array.isArray(body) ? body : [body];
    let paid = 0;
    let free = 0;
    for (const m of messages) {
      if (!m || typeof m !== 'object') continue;
      const { method, params } = m as {
        method?: unknown;
        params?: { name?: unknown; arguments?: { model?: unknown } };
      };
      if (method !== 'tools/call') continue;
      const name = String(params?.name ?? '');
      if (FREE_TOOLS.includes(name)) free += 1;
      else
        paid += McpDailyLimitGuard.units(
          name,
          params?.arguments?.model,
          defaultUnits,
        );
    }
    return { paid, free };
  }
}
