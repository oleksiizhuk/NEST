import { IssueFact } from '@application/project-manager/metrics';

// Weekly history for the Сотрудники page: how much each person closes per
// week and how much new work arrives, counted at refresh from two light Jira
// queries (no summaries, not in the model's snapshot text)

export const FLOW_WEEKS = 12;

export interface WeeklyFlow {
  // Monday (UTC) of each week, oldest first; the last one is this week
  weeks: string[];
  done: number[];
  created: number[];
  people: Record<string, number[]>;
  // A list hit its limit: the oldest weeks are lower bounds
  capped: boolean;
}

const isWork = (i: IssueFact) => !/^epic$/i.test(i.type);

const monday = (d: Date): Date => {
  const day = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day;
};

export const weeklyFlow = (
  done: IssueFact[],
  created: IssueFact[],
  now: Date,
  capped: boolean,
  weeks = FLOW_WEEKS,
): WeeklyFlow => {
  const start = monday(now);
  start.setUTCDate(start.getUTCDate() - 7 * (weeks - 1));
  const labels = Array.from({ length: weeks }, (_, i) =>
    new Date(start.getTime() + i * 7 * 86_400_000).toISOString().slice(0, 10),
  );
  const slot = (iso: string | null): number => {
    if (!iso) return -1;
    const i = Math.floor(
      (new Date(iso).getTime() - start.getTime()) / (7 * 86_400_000),
    );
    return i >= 0 && i < weeks && new Date(iso) <= now ? i : -1;
  };
  const flow: WeeklyFlow = {
    weeks: labels,
    done: labels.map(() => 0),
    created: labels.map(() => 0),
    people: {},
    capped,
  };
  const seen = new Set<string>();
  for (const i of done.filter(isWork)) {
    if (seen.has(i.key)) continue;
    seen.add(i.key);
    const w = slot(i.doneAt);
    if (w < 0) continue;
    flow.done[w] += 1;
    if (i.assignee) {
      const row = (flow.people[i.assignee] ??= labels.map(() => 0));
      row[w] += 1;
    }
  }
  for (const i of created.filter(isWork)) {
    const w = slot(i.created);
    if (w >= 0) flow.created[w] += 1;
  }
  return flow;
};

// Tasks per working day over the last four full weeks (this week is still
// going); null when nothing closed, so "no pace" is not read as "slow"
export const pacePerDay = (row: number[] | undefined): number | null => {
  if (!row || row.length < 2) return null;
  const full = row.slice(0, -1).slice(-4);
  const total = full.reduce((a, b) => a + b, 0);
  return total ? total / (full.length * 5) : null;
};

// Two or more of the last full weeks where more arrived than closed
export const scopeGrowing = (flow: WeeklyFlow): boolean => {
  const n = flow.weeks.length;
  if (n < 3) return false;
  return [n - 2, n - 3].every((i) => flow.created[i] > flow.done[i]);
};

export const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
