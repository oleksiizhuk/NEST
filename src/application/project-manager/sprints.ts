// Обещали — сделали: for the last sprints of the board, what was in the
// sprint when it started, what was added later, what got done by its end,
// and what was carried over. Team first; per person only on their card.

export interface SprintIssue {
  key: string;
  assignee: string | null;
  done: boolean;
  doneAt: string | null;
  // When this ticket was put into this sprint (changelog); null = it was
  // there from the start or the history is unknown
  addedAt: string | null;
}

export interface SprintData {
  id: number;
  name: string;
  state: 'active' | 'closed';
  start: string | null;
  end: string | null;
  issues: SprintIssue[];
}

export interface SprintRow {
  name: string;
  state: 'active' | 'closed';
  start: string | null;
  end: string | null;
  committed: number;
  added: number;
  doneCommitted: number;
  doneAdded: number;
  carried: number;
  // Done of what was committed, 0..1; null while there was no commitment
  sayDo: number | null;
}

export interface Sprints {
  rows: SprintRow[];
  // Last three closed sprints, per assignee
  people: Record<string, { committed: number; done: number }>;
}

// Tickets moved in during the first hour still count as planned
const GRACE_MS = 3_600_000;

export const sprintView = (sprints: SprintData[], now: Date): Sprints => {
  const rows: SprintRow[] = [];
  const people: Sprints['people'] = {};
  const closed = sprints
    .filter((s) => s.state === 'closed')
    .sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
  const recent = new Set(closed.slice(0, 3).map((s) => s.id));
  for (const s of [...sprints].sort((a, b) =>
    (a.start ?? '').localeCompare(b.start ?? ''),
  )) {
    const start = s.start ? Date.parse(s.start) : null;
    const end = s.end ? Date.parse(s.end) : now.getTime();
    const planned = (i: SprintIssue) =>
      !i.addedAt || start === null || Date.parse(i.addedAt) <= start + GRACE_MS;
    const doneInTime = (i: SprintIssue) =>
      i.done && (!i.doneAt || Date.parse(i.doneAt) <= end);
    const committed = s.issues.filter(planned);
    const added = s.issues.filter((i) => !planned(i));
    const doneCommitted = committed.filter(doneInTime).length;
    rows.push({
      name: s.name,
      state: s.state,
      start: s.start,
      end: s.end,
      committed: committed.length,
      added: added.length,
      doneCommitted,
      doneAdded: added.filter(doneInTime).length,
      carried: s.state === 'closed' ? committed.length - doneCommitted : 0,
      sayDo: committed.length
        ? Math.round((doneCommitted / committed.length) * 100) / 100
        : null,
    });
    if (recent.has(s.id))
      for (const i of committed) {
        if (!i.assignee) continue;
        const p = (people[i.assignee] ??= { committed: 0, done: 0 });
        p.committed += 1;
        if (doneInTime(i)) p.done += 1;
      }
  }
  return { rows, people };
};
