import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import { McpUsageDocument } from '@infrastructure/database/schemas/mcp-usage.schema';
import { FREE_TOOLS } from '@infrastructure/mcp/mcp-server.factory';
import { AssistantModel } from '@application/mcp/code-assistant.service.interface';
import {
  FREE_CALLS_PER_PAID,
  mcpDailyLimit,
  usageDay,
  usageKey,
} from '@application/mcp/mcp-budget';

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
// still count. MCP_DAILY_LIMIT unset = DEFAULT_DAILY_LIMIT; exactly 0 = off.
// Without the Mongo model (unit tests without a database) it passes.
@Injectable()
export class McpDailyLimitGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @InjectModel(McpUsageDocument.name)
    private readonly usage?: Model<McpUsageDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = mcpDailyLimit(
      this.configService.get<string>('MCP_DAILY_LIMIT'),
    );
    if (!this.usage || limit === 0) {
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
    const day = usageDay(new Date());
    // Free first: a batch refused on the free cap must not use paid quota
    if (free) {
      const freeLimit = limit * FREE_CALLS_PER_PAID;
      const count = await this.incrementForDay(
        this.usage,
        usageKey(day, 'free'),
        free,
      );
      if (count > freeLimit) {
        throw new HttpException(
          `Daily /mcp limit of ${freeLimit} task calls reached. Try again tomorrow (UTC).`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    if (paid) {
      const count = await this.incrementForDay(
        this.usage,
        usageKey(day, 'paid'),
        paid,
      );
      if (count > limit) {
        throw new HttpException(
          `Daily /mcp budget of ${limit} units reached (sonnet 1, opus 2, ` +
            'fable 4 per call). Try again tomorrow (UTC).',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
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

  // An upsert against the unique `day` index can race two first-of-day inserts
  // into a duplicate-key error (E11000); the loser retries and, the row now
  // existing, the $inc simply applies.
  private async incrementForDay(
    usage: Model<McpUsageDocument>,
    day: string,
    by: number,
  ): Promise<number> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const doc = await usage.findOneAndUpdate(
          { day },
          { $inc: { count: by } },
          { upsert: true, new: true },
        );
        return doc.count;
      } catch (error) {
        if ((error as { code?: number }).code === 11000 && attempt === 0) {
          continue;
        }
        throw error;
      }
    }
    /* istanbul ignore next: the loop either returns or throws above */
    return Number.POSITIVE_INFINITY;
  }
}
