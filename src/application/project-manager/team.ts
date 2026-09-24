import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { IssueFact, isBlocker } from '@application/project-manager/metrics';
import { workingDaysBetween } from '@application/project-manager/release-clock';

// Per-person work, kept on the snapshot at refresh so the admin page can
// show "who is on what" without calling Jira or GitHub again.

export interface PersonIssue {
  key: string;
  summary: string;
  status: string;
  inProgress: boolean;
  priority: string | null;
  inScope: boolean;
  statusSince: string | null;
  due: string | null;
  blocked: boolean;
}

export interface TeamIssues {
  releaseVersion: string | null;
  capped: boolean;
  people: Record<
    string,
    {
      open: PersonIssue[];
      done14: Array<{ key: string; summary: string; doneAt: string | null }>;
    }
  >;
}

export interface AuthorPull {
  repo: string;
  number: number;
  title: string;
  waitingDays: number;
  review: string;
  draft: boolean;
}

export interface TeamCode {
  authors: Record<string, { open: AuthorPull[]; merged14: string[] }>;
}

const HIGH = new Set(['highest', 'high', 'critical', 'blocker']);
const RANK: Record<string, number> = {
  blocker: 5,
  highest: 4,
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  lowest: 0,
};
const rank = (p: string | null) => RANK[(p ?? '').toLowerCase()] ?? 2;
const isWork = (i: IssueFact) => !/^epic$/i.test(i.type);

export const teamIssues = (
  open: IssueFact[],
  done: IssueFact[],
  now: Date,
  releaseVersion: string | null,
  capped: boolean,
): TeamIssues => {
  const since = now.getTime() - 14 * 86_400_000;
  const people: TeamIssues['people'] = {};
  const person = (name: string) => (people[name] ??= { open: [], done14: [] });
  for (const i of open.filter(isWork)) {
    if (!i.assignee) continue;
    person(i.assignee).open.push({
      key: i.key,
      summary: (i.summary ?? '').slice(0, 140),
      status: i.status,
      inProgress: i.category === 'indeterminate',
      priority: i.priority,
      inScope: releaseVersion ? i.fixVersions.includes(releaseVersion) : true,
      statusSince: i.statusSince,
      due: i.due,
      blocked:
        isBlocker(i) && Boolean(i.blockedBy?.length || /block/i.test(i.status)),
    });
  }
  for (const i of done.filter(isWork)) {
    if (!i.assignee || !i.doneAt || new Date(i.doneAt).getTime() < since)
      continue;
    person(i.assignee).done14.push({
      key: i.key,
      summary: (i.summary ?? '').slice(0, 140),
      doneAt: i.doneAt,
    });
  }
  return { releaseVersion, capped, people };
};

export interface PersonView {
  name: string;
  github: string | null;
  inProgress: Array<PersonIssue & { days: number | null }>;
  queue: PersonIssue[];
  done14: Array<{ key: string; summary: string; doneAt: string | null }>;
  pulls: AuthorPull[];
  merged14: string[];
  signals: Array<{ level: 'warn' | 'info' | 'ok'; text: string }>;
}

const STALE_DAYS = 5;
const WIP_LIMIT = 2;

export const personSignals = (
  p: Omit<PersonView, 'signals' | 'name' | 'github'>,
  releaseVersion: string | null,
  now: Date,
): PersonView['signals'] => {
  const out: PersonView['signals'] = [];
  const keys = (list: Array<{ key: string }>) =>
    list
      .slice(0, 4)
      .map((i) => i.key)
      .join(', ');
  if (p.inProgress.length > WIP_LIMIT) {
    out.push({
      level: 'warn',
      text: `В работе ${p.inProgress.length} задач сразу — лучше довести до конца 1–2.`,
    });
  }
  const stale = p.inProgress.filter((i) => (i.days ?? 0) > STALE_DAYS);
  for (const i of stale.slice(0, 3)) {
    out.push({
      level: 'warn',
      text: `${i.key} в работе уже ${i.days} раб. дн. — узнать, что мешает.`,
    });
  }
  if (releaseVersion) {
    const offScope = p.inProgress.filter((i) => !i.inScope);
    const scopeQueue = p.queue.filter((i) => i.inScope);
    if (offScope.length && scopeQueue.length) {
      out.push({
        level: 'warn',
        text: `${offScope.length} из ${
          p.inProgress.length
        } задач в работе не из релиза ${releaseVersion}, а релизные ждут: ${keys(
          scopeQueue,
        )}.`,
      });
    }
  }
  const topQueued = p.queue.filter((i) =>
    HIGH.has((i.priority ?? '').toLowerCase()),
  );
  const maxWorking = Math.max(-1, ...p.inProgress.map((i) => rank(i.priority)));
  const higherWaiting = topQueued.filter((i) => rank(i.priority) > maxWorking);
  if (higherWaiting.length && p.inProgress.length) {
    out.push({
      level: 'warn',
      text: `В очереди приоритетнее, чем то, что в работе: ${keys(
        higherWaiting,
      )}.`,
    });
  }
  const today = now.toISOString().slice(0, 10);
  const overdue = [...p.inProgress, ...p.queue].filter(
    (i) => i.due && i.due < today,
  );
  if (overdue.length)
    out.push({ level: 'warn', text: `Просрочено: ${keys(overdue)}.` });
  const blocked = [...p.inProgress, ...p.queue].filter((i) => i.blocked);
  if (blocked.length)
    out.push({
      level: 'warn',
      text: `Заблокировано: ${keys(blocked)} — нужен владелец блокера.`,
    });
  if (!p.inProgress.length && p.queue.length) {
    out.push({
      level: 'info',
      text: `Ничего не в работе, в очереди ${p.queue.length}: ${keys(
        p.queue,
      )}.`,
    });
  }
  if (
    !p.done14.length &&
    !p.merged14.length &&
    (p.inProgress.length || p.queue.length)
  ) {
    out.push({
      level: 'warn',
      text: 'За 14 дней ничего не закрыто и не смёржено.',
    });
  }
  for (const pr of p.pulls
    .filter(
      (x) => !x.draft && x.review === 'no review yet' && x.waitingDays > 2,
    )
    .slice(0, 3)) {
    out.push({
      level: 'warn',
      text: `PR ${pr.repo}#${pr.number} ждёт ревью ${pr.waitingDays} раб. дн.`,
    });
  }
  for (const pr of p.pulls
    .filter((x) => x.review === 'CHANGES_REQUESTED')
    .slice(0, 3)) {
    out.push({
      level: 'info',
      text: `PR ${pr.repo}#${pr.number}: попросили правки.`,
    });
  }
  if (!out.length)
    out.push({
      level: 'ok',
      text: 'Идёт по плану: явных проблем в данных нет.',
    });
  return out;
};

// Jira people with their GitHub side matched by the owner's mapping
export const buildTeam = (
  snapshot: ProjectSnapshot,
  githubLogins: Record<string, string>,
  now: Date,
): {
  asOf: Date;
  releaseVersion: string | null;
  capped: boolean;
  people: PersonView[];
  unmatchedGithub: string[];
} => {
  const issues = snapshot.section('issues')?.details as unknown as
    | TeamIssues
    | undefined;
  const code = snapshot.section('code')?.details as unknown as
    | TeamCode
    | undefined;
  const authors = code?.authors ?? {};
  const used = new Set<string>();
  const people = Object.entries(issues?.people ?? {})
    .map(([name, work]) => {
      const github = githubLogins[name] ?? null;
      const gh = github ? authors[github] : undefined;
      if (github) used.add(github);
      const base = {
        inProgress: work.open
          .filter((i) => i.inProgress)
          .map((i) => ({
            ...i,
            days: i.statusSince
              ? workingDaysBetween(new Date(i.statusSince), now)
              : null,
          })),
        queue: work.open
          .filter((i) => !i.inProgress)
          .sort((a, b) => rank(b.priority) - rank(a.priority)),
        done14: work.done14,
        pulls: gh?.open ?? [],
        merged14: gh?.merged14 ?? [],
      };
      return {
        name,
        github,
        ...base,
        signals: personSignals(base, issues?.releaseVersion ?? null, now),
      };
    })
    .sort(
      (a, b) =>
        b.signals.filter((s) => s.level === 'warn').length -
          a.signals.filter((s) => s.level === 'warn').length ||
        a.name.localeCompare(b.name),
    );
  return {
    asOf: snapshot.createdAt,
    releaseVersion: issues?.releaseVersion ?? null,
    capped: issues?.capped ?? false,
    people,
    unmatchedGithub: Object.keys(authors)
      .filter((a) => !used.has(a))
      .sort(),
  };
};
