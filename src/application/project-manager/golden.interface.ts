export const PM_GOLDEN = 'PM_GOLDEN';

export interface GoldenInput {
  id: string;
  question: string;
  // Each must appear in the answer (case-insensitive); "/re/" = a regex
  mustContain: string[];
  mustNotContain: string[];
  maxSeconds: number;
}

export interface GoldenResult {
  at: Date;
  pass: boolean;
  seconds: number;
  failures: string[];
  answer: string;
}

export interface GoldenCase extends GoldenInput {
  last: GoldenResult | null;
}

// Questions with known good answers, run weekly to catch regressions
export interface IGoldenStore {
  all(): Promise<GoldenCase[]>;
  replaceAll(cases: GoldenInput[]): Promise<void>;
  saveResult(id: string, result: GoldenResult): Promise<void>;
}
