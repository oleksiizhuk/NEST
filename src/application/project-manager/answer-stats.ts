import { AnswerRecord } from '@domain/telegram/telegram-message.repository.interface';

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const avg = (values: number[]): number =>
  values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : 0;

// Quality at a glance: how answers are rated, how long they take, what they
// cost in tokens, and the 👎 ones to look at first
export const summarizeAnswers = (records: AnswerRecord[]) => {
  const usage = records.map((r) => r.usage ?? {});
  return {
    answers: records.length,
    up: records.filter((r) => r.vote === 1).length,
    down: records.filter((r) => r.vote === -1).length,
    avgSeconds: avg(usage.map((u) => num(u.ms))) / 1000,
    avgInputTokens: avg(usage.map((u) => num(u.inputTokens))),
    avgCacheReadTokens: avg(usage.map((u) => num(u.cacheReadTokens))),
    avgCacheWriteTokens: avg(usage.map((u) => num(u.cacheWriteTokens))),
    avgOutputTokens: avg(usage.map((u) => num(u.outputTokens))),
    disliked: records
      .filter((r) => r.vote === -1)
      .slice(0, 20)
      .map((r) => ({
        at: r.createdAt,
        question: (r.question ?? '').slice(0, 300),
        seconds: num(r.usage?.ms) / 1000,
        tools: Array.isArray(r.usage?.tools) ? r.usage?.tools : [],
      })),
  };
};
