import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  bearerMatches,
  McpStatsTokenGuard,
  McpTokenGuard,
} from '@infrastructure/http/mcp/guards/mcp-token.guard';

const ctx = (authorization?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext);
const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] } as unknown as ConfigService);

describe('bearerMatches', () => {
  it('accepts only the exact bearer secret, and nothing without a secret', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true);
    expect(bearerMatches('Bearer s3cre', 's3cret')).toBe(false);
    expect(bearerMatches('Basic s3cret', 's3cret')).toBe(false);
    expect(bearerMatches('Bearer ', 's3cret')).toBe(false);
    expect(bearerMatches(undefined, 's3cret')).toBe(false);
    expect(bearerMatches('Bearer anything', undefined)).toBe(false);
    expect(bearerMatches('Bearer ', '')).toBe(false);
  });
});

describe('McpTokenGuard', () => {
  it('lets the IDE token through and refuses the rest', () => {
    const guard = new McpTokenGuard(config({ MCP_TOKEN: 'ide' }));
    expect(guard.canActivate(ctx('Bearer ide'))).toBe(true);
    expect(() => guard.canActivate(ctx('Bearer other'))).toThrow(
      UnauthorizedException,
    );
  });
});

const OWNER = 'owner-stats-token-0123456789abcdef';

describe('McpStatsTokenGuard', () => {
  it('takes the stats token only', () => {
    const guard = new McpStatsTokenGuard(
      config({ MCP_TOKEN: 'ide', MCP_STATS_TOKEN: OWNER }),
    );
    expect(guard.canActivate(ctx(`Bearer ${OWNER}`))).toBe(true);
    expect(() => guard.canActivate(ctx('Bearer ide'))).toThrow(
      UnauthorizedException,
    );
  });

  it('is closed when the stats token is unset', () => {
    const guard = new McpStatsTokenGuard(config({ MCP_TOKEN: 'ide' }));
    expect(() => guard.canActivate(ctx('Bearer ide'))).toThrow(
      UnauthorizedException,
    );
  });

  it('is closed when the stats token is the IDE token, even with stray whitespace', () => {
    const guard = new McpStatsTokenGuard(
      config({ MCP_TOKEN: `${OWNER}\n`, MCP_STATS_TOKEN: OWNER }),
    );
    expect(() => guard.canActivate(ctx(`Bearer ${OWNER}`))).toThrow(
      UnauthorizedException,
    );
  });

  it('is closed when the stats token is too short to resist guessing', () => {
    const guard = new McpStatsTokenGuard(
      config({ MCP_TOKEN: 'ide', MCP_STATS_TOKEN: 'stats1' }),
    );
    expect(() => guard.canActivate(ctx('Bearer stats1'))).toThrow(
      UnauthorizedException,
    );
  });
});
