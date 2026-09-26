import { IssueFact, isBug } from '@application/project-manager/metrics';

// Quality and areas, by Jira component: where bugs come in, which area
// only one person knows, and how much of each person's work was bugs.
// Areas and the team, never a ranking of people.

export const NO_AREA = 'без компонента';
const DAY = 86_400_000;

// Epics and sub-tasks are not area work: Jira does not copy components to
// sub-tasks, and their story already counts
const isWork = (i: IssueFact) => !/^epic$|sub-?task|подзадач/i.test(i.type);
const areasOf = (i: IssueFact) =>
  i.components?.length ? i.components : [NO_AREA];

export interface AreaRow {
  name: string;
  // Bugs created in the last 14 days and the 14 before
  bugsNew: number;
  bugsBefore: number;
  openBugs: number;
  openBugKeys: string[];
  open: number;
  // Closed in the 12-week history, and who closed most of it
  done: number;
  owner: { name: string; share: number } | null;
  backup: string | null;
  // One person closed over 80% of 5+ tickets and work is still open
  busRisk: boolean;
}

export interface Areas {
  areas: AreaRow[];
  // Share of open work with no component: above ~50% the page says the
  // areas are not reliable
  noAreaShare: number;
  // Per person over the last 28 days: closed, and how many were bugs
  people: Record<string, { done: number; bugs: number }>;
  // A Jira list hit its limit: counts are lower bounds
  capped: boolean;
}

export const areaView = (
  open: IssueFact[],
  done: IssueFact[],
  created: IssueFact[],
  now: Date,
  capped = false,
): Areas => {
  const t = now.getTime();
  const rows = new Map<string, AreaRow>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r) {
      r = {
        name,
        bugsNew: 0,
        bugsBefore: 0,
        openBugs: 0,
        openBugKeys: [],
        open: 0,
        done: 0,
        owner: null,
        backup: null,
        busRisk: false,
      };
      rows.set(name, r);
    }
    return r;
  };
  const seenCreated = new Set<string>();
  for (const i of created.filter(isWork)) {
    if (!isBug(i) || !i.created || seenCreated.has(i.key)) continue;
    seenCreated.add(i.key);
    const age = t - Date.parse(i.created);
    for (const a of areasOf(i)) {
      if (age <= 14 * DAY) row(a).bugsNew += 1;
      else if (age <= 28 * DAY) row(a).bugsBefore += 1;
    }
  }
  const openWork = open.filter(isWork);
  for (const i of openWork)
    for (const a of areasOf(i)) {
      const r = row(a);
      r.open += 1;
      if (isBug(i)) {
        r.openBugs += 1;
        if (r.openBugKeys.length < 3) r.openBugKeys.push(i.key);
      }
    }
  const closers = new Map<string, Map<string, number>>();
  const people: Areas['people'] = {};
  const seenDone = new Set<string>();
  for (const i of done.filter(isWork)) {
    if (seenDone.has(i.key)) continue;
    // The 14-day list holds old tickets edited lately (say, a component
    // backfill); only closes inside the 12 weeks count
    if (!i.doneAt || t - Date.parse(i.doneAt) > 84 * DAY) continue;
    seenDone.add(i.key);
    for (const a of areasOf(i)) {
      row(a).done += 1;
      if (i.assignee) {
        const m = closers.get(a) ?? new Map<string, number>();
        m.set(i.assignee, (m.get(i.assignee) ?? 0) + 1);
        closers.set(a, m);
      }
    }
    if (i.assignee && i.doneAt && t - Date.parse(i.doneAt) <= 28 * DAY) {
      const p = (people[i.assignee] ??= { done: 0, bugs: 0 });
      p.done += 1;
      if (isBug(i)) p.bugs += 1;
    }
  }
  for (const [name, m] of closers) {
    const r = row(name);
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((n, [, c]) => n + c, 0);
    if (!ranked.length || !total) continue;
    const share = Math.round((ranked[0][1] / total) * 100) / 100;
    r.owner = { name: ranked[0][0], share };
    r.backup = ranked[1]?.[0] ?? null;
    r.busRisk = name !== NO_AREA && total >= 5 && share > 0.8 && r.open > 0;
  }
  const noArea = openWork.filter((i) => !i.components?.length).length;
  return {
    areas: [...rows.values()].sort(
      (a, b) =>
        Number(b.name !== NO_AREA) - Number(a.name !== NO_AREA) ||
        b.bugsNew - a.bugsNew ||
        b.open - a.open ||
        a.name.localeCompare(b.name),
    ),
    noAreaShare: openWork.length
      ? Math.round((noArea / openWork.length) * 100) / 100
      : 0,
    people,
    capped,
  };
};
