import { GoldenInput } from '@application/project-manager/golden.interface';

const MAX_CASES = 50;
const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/i;

const strings = (value: unknown, field: string): string[] => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 200)
  ) {
    throw new Error(`${field}: a list of non-empty strings up to 200 chars`);
  }
  return value as string[];
};

// Validates the uploaded golden questions; throws with the first problem
export const parseGolden = (input: unknown[]): GoldenInput[] => {
  if (input.length > MAX_CASES) throw new Error(`at most ${MAX_CASES} cases`);
  const seen = new Set<string>();
  return input.map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const id = String(c.id ?? '');
    if (!ID.test(id)) throw new Error(`case ${i}: bad id`);
    if (seen.has(id)) throw new Error(`case ${i}: duplicate id ${id}`);
    seen.add(id);
    const question = typeof c.question === 'string' ? c.question.trim() : '';
    if (!question || question.length > 500)
      throw new Error(`case ${id}: question of 1-500 chars`);
    const maxSeconds = c.maxSeconds === undefined ? 120 : Number(c.maxSeconds);
    if (!Number.isFinite(maxSeconds) || maxSeconds < 10 || maxSeconds > 200)
      throw new Error(`case ${id}: maxSeconds 10-200`);
    return {
      id,
      question,
      mustContain: strings(c.mustContain, `case ${id} mustContain`),
      mustNotContain: strings(c.mustNotContain, `case ${id} mustNotContain`),
      maxSeconds,
    };
  });
};
