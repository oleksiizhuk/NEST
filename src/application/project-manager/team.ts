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

export type SignalRule =
  | 'wip'
  | 'stale'
  | 'off-release'
  | 'priority'
  | 'overdue'
  | 'blocked'
  | 'idle'
  | 'no-output'
  | 'pr-wait'
  | 'changes'
  | 'away'
  | 'handover'
  | 'ok';

// Rules the owner may switch off on the admin page
export const TOGGLEABLE_RULES: SignalRule[] = [
  'wip',
  'stale',
  'off-release',
  'priority',
  'overdue',
  'blocked',
  'idle',
  'no-output',
  'pr-wait',
  'changes',
];

export interface Signal {
  level: 'warn' | 'info' | 'ok';
  rule: SignalRule;
  text: string;
  // The value against the threshold, e.g. "в работе с 12.09: 7 раб. дн. > 5"
  why?: string;
  // Ticket keys or repo#number the signal is about
  keys: string[];
  // A sentence the owner can say or send to the person
  say?: string;
}

export interface PersonView {
  name: string;
  github: string | null;
  away: { until: string; note: string | null } | null;
  inProgress: Array<PersonIssue & { days: number | null }>;
  queue: PersonIssue[];
  done14: Array<{ key: string; summary: string; doneAt: string | null }>;
  pulls: AuthorPull[];
  merged14: string[];
  signals: Signal[];
}

export interface TeamThresholds {
  // More tasks in progress at once than this is a warning
  wipLimit: number;
  // Working days in progress before a task counts as stuck
  staleDays: number;
  // Working days a PR may wait for its first review
  reviewWaitDays: number;
  off: SignalRule[];
}

export const DEFAULT_THRESHOLDS: TeamThresholds = {
  wipLimit: 2,
  staleDays: 5,
  reviewWaitDays: 2,
  off: [],
};

export type TeamAway = Record<string, { until: string; note?: string | null }>;

const ruDate = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}`;
};

export const personSignals = (
  p: Omit<PersonView, 'signals' | 'name' | 'github' | 'away'>,
  releaseVersion: string | null,
  now: Date,
  limits: TeamThresholds = DEFAULT_THRESHOLDS,
  away: PersonView['away'] = null,
): Signal[] => {
  const out: Signal[] = [];
  const list = (items: Array<{ key: string }>) =>
    items.slice(0, 4).map((i) => i.key);
  const keys = (items: Array<{ key: string }>) => list(items).join(', ');
  const today = now.toISOString().slice(0, 10);

  // Nobody is asked about their tasks while away; only work that the
  // release waits for is worth handing over
  if (away && away.until >= today) {
    out.push({
      level: 'info',
      rule: 'away',
      text: `Отсутствует до ${ruDate(away.until)}${
        away.note ? ` (${away.note})` : ''
      } — сигналы по задачам не считаются.`,
      keys: [],
    });
    const release = p.inProgress.filter((i) => i.inScope);
    if (releaseVersion && release.length)
      out.push({
        level: 'warn',
        rule: 'handover',
        text: `В работе релизные задачи: ${keys(
          release,
        )} — передать на время отсутствия?`,
        why: `отсутствует до ${ruDate(away.until)}, релиз ${releaseVersion}`,
        keys: list(release),
        say: `Пока тебя нет, кому передаём ${keys(release)}?`,
      });
    return out;
  }

  const on = (rule: SignalRule) => !limits.off.includes(rule);
  if (on('wip') && p.inProgress.length > limits.wipLimit) {
    out.push({
      level: 'warn',
      rule: 'wip',
      text: `В работе ${p.inProgress.length} задач сразу — лучше довести до конца 1–2.`,
      why: `в работе ${p.inProgress.length} > порог ${limits.wipLimit}`,
      keys: list(p.inProgress),
      say: `Сейчас у тебя ${p.inProgress.length} задач в работе — какую доводим первой?`,
    });
  }
  if (on('stale')) {
    const stale = p.inProgress.filter((i) => (i.days ?? 0) > limits.staleDays);
    for (const i of stale.slice(0, 3)) {
      out.push({
        level: 'warn',
        rule: 'stale',
        text: `${i.key} в работе уже ${i.days} раб. дн. — узнать, что мешает.`,
        why: `в работе${i.statusSince ? ` с ${ruDate(i.statusSince)}` : ''}: ${
          i.days
        } раб. дн. > порог ${limits.staleDays}`,
        keys: [i.key],
        say: `${i.key} в работе ${i.days} дней — что мешает закрыть? Нужна помощь?`,
      });
    }
  }
  if (releaseVersion && on('off-release')) {
    const offScope = p.inProgress.filter((i) => !i.inScope);
    const scopeQueue = p.queue.filter((i) => i.inScope);
    if (offScope.length && scopeQueue.length) {
      out.push({
        level: 'warn',
        rule: 'off-release',
        text: `${offScope.length} из ${
          p.inProgress.length
        } задач в работе не из релиза ${releaseVersion}, а релизные ждут: ${keys(
          scopeQueue,
        )}.`,
        why: `не из релиза в работе: ${keys(offScope)}`,
        keys: list(scopeQueue),
        say: `Давай сначала релизные: ${keys(scopeQueue)}. ${keys(
          offScope,
        )} можно отложить?`,
      });
    }
  }
  const topQueued = p.queue.filter((i) =>
    HIGH.has((i.priority ?? '').toLowerCase()),
  );
  const maxWorking = Math.max(-1, ...p.inProgress.map((i) => rank(i.priority)));
  const higherWaiting = topQueued.filter((i) => rank(i.priority) > maxWorking);
  if (on('priority') && higherWaiting.length && p.inProgress.length) {
    out.push({
      level: 'warn',
      rule: 'priority',
      text: `В очереди приоритетнее, чем то, что в работе: ${keys(
        higherWaiting,
      )}.`,
      why: `в очереди ${higherWaiting[0].priority}, в работе не выше ${
        p.inProgress.map((i) => i.priority ?? '—').join('/') || '—'
      }`,
      keys: list(higherWaiting),
      say: `${keys(higherWaiting)} приоритетнее текущих задач — переключаемся?`,
    });
  }
  const overdue = [...p.inProgress, ...p.queue].filter(
    (i) => i.due && i.due < today,
  );
  if (on('overdue') && overdue.length)
    out.push({
      level: 'warn',
      rule: 'overdue',
      text: `Просрочено: ${keys(overdue)}.`,
      why: overdue
        .slice(0, 4)
        .map((i) => `${i.key} срок ${ruDate(i.due as string)}`)
        .join(', '),
      keys: list(overdue),
      say: `По ${keys(overdue)} срок прошёл — какая новая реальная дата?`,
    });
  const blocked = [...p.inProgress, ...p.queue].filter((i) => i.blocked);
  if (on('blocked') && blocked.length)
    out.push({
      level: 'warn',
      rule: 'blocked',
      text: `Заблокировано: ${keys(blocked)} — нужен владелец блокера.`,
      why: 'статус или связь «is blocked by» в Jira',
      keys: list(blocked),
      say: `Что блокирует ${keys(blocked)}? Кто может снять блок и когда?`,
    });
  if (on('idle') && !p.inProgress.length && p.queue.length) {
    out.push({
      level: 'info',
      rule: 'idle',
      text: `Ничего не в работе, в очереди ${p.queue.length}: ${keys(
        p.queue,
      )}.`,
      why: 'в работе 0, очередь не пуста',
      keys: list(p.queue),
      say: `Что берёшь следующим? Предлагаю ${p.queue[0].key}.`,
    });
  }
  if (
    on('no-output') &&
    !p.done14.length &&
    !p.merged14.length &&
    (p.inProgress.length || p.queue.length)
  ) {
    out.push({
      level: 'warn',
      rule: 'no-output',
      text: 'За 14 дней ничего не закрыто и не смёржено.',
      why: 'закрыто 0, смёржено 0 за 14 дней при открытых задачах',
      keys: list(p.inProgress),
      say: 'Как идут дела? За две недели ничего не закрылось — что мешает?',
    });
  }
  if (on('pr-wait'))
    for (const pr of p.pulls
      .filter(
        (x) =>
          !x.draft &&
          x.review === 'no review yet' &&
          x.waitingDays > limits.reviewWaitDays,
      )
      .slice(0, 3)) {
      out.push({
        level: 'warn',
        rule: 'pr-wait',
        text: `PR ${pr.repo}#${pr.number} ждёт ревью ${pr.waitingDays} раб. дн.`,
        why: `без ревью ${pr.waitingDays} раб. дн. > порог ${limits.reviewWaitDays}`,
        keys: [`${pr.repo}#${pr.number}`],
        say: `Кто может посмотреть PR ${pr.repo}#${pr.number}? Ждёт ревью ${pr.waitingDays} дня.`,
      });
    }
  if (on('changes'))
    for (const pr of p.pulls
      .filter((x) => x.review === 'CHANGES_REQUESTED')
      .slice(0, 3)) {
      out.push({
        level: 'info',
        rule: 'changes',
        text: `PR ${pr.repo}#${pr.number}: попросили правки.`,
        keys: [`${pr.repo}#${pr.number}`],
        say: `По PR ${pr.repo}#${pr.number} попросили правки — когда успеешь?`,
      });
    }
  if (!out.length)
    out.push({
      level: 'ok',
      rule: 'ok',
      text: 'Идёт по плану: явных проблем в данных нет.',
      keys: [],
    });
  return out;
};

// How urgent each rule is for "Сегодня"; release work adds on top
const WEIGHT: Partial<Record<SignalRule, number>> = {
  blocked: 90,
  handover: 85,
  'off-release': 80,
  'pr-wait': 70,
  stale: 65,
  overdue: 60,
  idle: 55,
  priority: 50,
  wip: 40,
  'no-output': 30,
  changes: 20,
};

export interface TodayItem extends Signal {
  id: string;
  person: string;
  inRelease: boolean;
}

// The few things the owner should act on today, across the whole team
export const todayItems = (
  people: PersonView[],
  hidden: Set<string>,
  limit = 5,
): { items: TodayItem[]; more: number } => {
  const all: Array<{ score: number; item: TodayItem }> = [];
  for (const p of people) {
    const release = new Set(
      [...p.inProgress, ...p.queue].filter((i) => i.inScope).map((i) => i.key),
    );
    for (const s of p.signals) {
      const weight = WEIGHT[s.rule];
      if (!weight) continue;
      const id = `${s.rule}|${p.name}|${s.keys.join(',')}`;
      if (hidden.has(id)) continue;
      const inRelease = s.keys.some((k) => release.has(k));
      all.push({
        score: weight + (inRelease ? 10 : 0),
        item: { ...s, id, person: p.name, inRelease },
      });
    }
  }
  all.sort(
    (a, b) => b.score - a.score || a.item.person.localeCompare(b.item.person),
  );
  return {
    items: all.slice(0, limit).map((x) => x.item),
    more: Math.max(0, all.length - limit),
  };
};

// Jira people with their GitHub side matched by the owner's mapping
export const buildTeam = (
  snapshot: ProjectSnapshot,
  githubLogins: Record<string, string>,
  now: Date,
  options: { thresholds?: TeamThresholds; away?: TeamAway } = {},
): {
  asOf: Date;
  releaseVersion: string | null;
  capped: boolean;
  people: PersonView[];
  unmatchedGithub: string[];
  thresholds: TeamThresholds;
  // False for a snapshot built before per-person data existed
  hasDetails: boolean;
} => {
  const issues = snapshot.section('issues')?.details as unknown as
    | TeamIssues
    | undefined;
  const code = snapshot.section('code')?.details as unknown as
    | TeamCode
    | undefined;
  const authors = code?.authors ?? {};
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
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
      const off = options.away?.[name];
      const away = off ? { until: off.until, note: off.note ?? null } : null;
      return {
        name,
        github,
        away,
        ...base,
        signals: personSignals(
          base,
          issues?.releaseVersion ?? null,
          now,
          thresholds,
          away,
        ),
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
    thresholds,
    hasDetails: Boolean(issues),
  };
};
