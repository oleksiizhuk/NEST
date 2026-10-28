// Once the Anthropic key's spend limit is used up, every call is refused
// until the date the API names: 400 invalid_request_error "You have reached
// your specified API usage limits. You will regain access on 2026-11-01 at
// 00:00 UTC." Retrying is pointless, so callers say so instead of "busy".
export interface AiUsageLimit {
  // When access comes back; null when the message names no date
  until: Date | null;
}

const LIMIT = /reached your specified API usage limit/i;
const UNTIL =
  /regain access on (\d{4}-\d{2}-\d{2})(?:\s+at\s+(\d{1,2}):(\d{2})\s*UTC)?/i;

// The SDK error, or a wrapper that keeps it as cause
const messagesOf = (error: unknown): string[] => {
  const out: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === 'string') {
      out.push(current);
      break;
    }
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string') out.push(message);
    current = (current as { cause?: unknown }).cause;
  }
  return out;
};

export const usageLimitOf = (error: unknown): AiUsageLimit | null => {
  const message = messagesOf(error).find((m) => LIMIT.test(m));
  if (!message) return null;
  const m = UNTIL.exec(message);
  if (!m) return { until: null };
  const hours = (m[2] ?? '0').padStart(2, '0');
  const until = new Date(`${m[1]}T${hours}:${m[3] ?? '00'}:00Z`);
  return { until: Number.isNaN(until.getTime()) ? null : until };
};

// "2026-11-01 00:00 UTC", or null without a date
export const untilText = (limit: AiUsageLimit): string | null =>
  limit.until
    ? `${limit.until.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : null;

// For the owner in Telegram
export const usageLimitNotice = (limit: AiUsageLimit): string => {
  const until = untilText(limit);
  return [
    until
      ? `Лимит расходов Anthropic API исчерпан до ${until}: до этого бот не может ни писать сводку, ни отвечать.`
      : 'Лимит расходов Anthropic API исчерпан: пока его не поднять, бот не может ни писать сводку, ни отвечать.',
    'Поднять лимит: console.anthropic.com → Settings → Limits.',
  ].join('\n');
};
