import {
  untilText,
  usageLimitNotice,
  usageLimitOf,
} from '@application/shared/ai-usage-limit';

const SDK_MESSAGE =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."},"request_id":"req_x"}';

describe('usageLimitOf', () => {
  it('reads the date from the API error', () => {
    const limit = usageLimitOf(new Error(SDK_MESSAGE));
    expect(limit?.until?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(untilText(limit!)).toBe('2026-11-01 00:00 UTC');
  });

  it('finds it under a wrapper that keeps the cause', () => {
    const wrapped = Object.assign(new Error('call failed'), {
      cause: new Error(SDK_MESSAGE),
    });
    expect(usageLimitOf(wrapped)).not.toBeNull();
  });

  it('knows the limit without a date', () => {
    const limit = usageLimitOf(
      new Error('You have reached your specified API usage limits.'),
    );
    expect(limit).toEqual({ until: null });
    expect(usageLimitNotice(limit!)).not.toMatch(/исчерпан до/);
  });

  it('is not fooled by other errors', () => {
    expect(usageLimitOf(new Error('529 overloaded'))).toBeNull();
    expect(usageLimitOf(new Error('429 rate_limit_error'))).toBeNull();
    expect(usageLimitOf(null)).toBeNull();
    expect(usageLimitOf(undefined)).toBeNull();
  });
});
