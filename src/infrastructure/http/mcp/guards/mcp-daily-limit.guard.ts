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

// A leaked MCP_TOKEN would otherwise buy unlimited paid model calls (a
// financial DoS). This caps calls per UTC day with a shared Mongo counter,
// incremented atomically so concurrent serverless invocations still count.
// The cap is off unless MCP_DAILY_LIMIT is a positive number and the Mongo
// model is available (so unit tests without a database are unaffected).
@Injectable()
export class McpDailyLimitGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @InjectModel(McpUsageDocument.name)
    private readonly usage?: Model<McpUsageDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const limit = Number(this.configService.get<string>('MCP_DAILY_LIMIT'));
    if (!this.usage || !Number.isFinite(limit) || limit <= 0) {
      return true; // cap disabled
    }

    // Only paid tool calls count. In stateless Streamable HTTP the handshake
    // (initialize, tools/list) and notifications are each their own POST;
    // charging them would make the effective cap a fraction of
    // MCP_DAILY_LIMIT and vary with how each client opens a session.
    if (!McpDailyLimitGuard.isPaidToolCall(context)) {
      return true;
    }

    // Counted before the call, on purpose: each attempt reaches the paid API,
    // so a hard DoS cap must count attempts (including failures and client
    // retries), not only completions.
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const count = await this.incrementForDay(this.usage, day);

    if (count > limit) {
      throw new HttpException(
        `Daily /mcp call limit of ${limit} reached. Try again tomorrow (UTC).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private static isPaidToolCall(context: ExecutionContext): boolean {
    const body = context.switchToHttp().getRequest<Request>().body as unknown;
    // A JSON-RPC request may arrive alone or batched in an array.
    const messages = Array.isArray(body) ? body : [body];
    return messages.some(
      (m) =>
        !!m &&
        typeof m === 'object' &&
        (m as { method?: unknown }).method === 'tools/call',
    );
  }

  // An upsert against the unique `day` index can race two first-of-day inserts
  // into a duplicate-key error (E11000); the loser retries and, the row now
  // existing, the $inc simply applies.
  private async incrementForDay(
    usage: Model<McpUsageDocument>,
    day: string,
  ): Promise<number> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const doc = await usage.findOneAndUpdate(
          { day },
          { $inc: { count: 1 } },
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
