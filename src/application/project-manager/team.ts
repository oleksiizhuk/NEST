import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import { IssueFact, isBlocker } from '@application/project-manager/metrics';
import { workingDaysBetween } from '@application/project-manager/release-clock';
import {
  median,
  pacePerDay,
  scopeGrowing,
  WeeklyFlow,
} from '@application/project-manager/load';

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

export interface FreeIssue {
  key: string;
  summary: string;
  priority: string | null;
  inScope: boolean;
}

export interface TeamIssues {
  releaseVersion: string | null;
  capped: boolean;
  // Open work nobody owns, release work and higher priority first
  unassigned?: FreeIssue[];
  // Added by the Jira reader: 12 weeks of closed / created counts
  flow?: WeeklyFlow | null;
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
  const inScope = (i: IssueFact) =>
    releaseVersion ? i.fixVersions.includes(releaseVersion) : true;
  const unassigned = open
    .filter((i) => isWork(i) && !i.assignee && i.category !== 'done')
    .sort(
      (a, b) =>
        Number(inScope(b)) - Number(inScope(a)) ||
        rank(b.priority) - rank(a.priority),
    )
    .slice(0, 15)
    .map((i) => ({
      key: i.key,
      summary: (i.summary ?? '').slice(0, 140),
      priority: i.priority,
      inScope: inScope(i),
    }));
  for (const i of done.filter(isWork)) {
    if (!i.assignee || !i.doneAt || new Date(i.doneAt).getTime() < since)
      continue;
    person(i.assignee).done14.push({
      key: i.key,
      summary: (i.summary ?? '').slice(0, 140),
      doneAt: i.doneAt,
    });
  }
  return { releaseVersion, capped, unassigned, people };
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
  | 'overload'
  | 'underload'
  | 'runway'
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
  'overload',
  'underload',
  'runway',
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
  // What "Сегодня" hides by, when the keys are only suggestions that change
  // on their own (free tickets, the queue top)
  subject?: string;
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
  load: PersonLoad;
  signals: Signal[];
}

export interface PersonLoad {
  // Open work on the person: in progress + queue
  total: number;
  // The same number's median across the team (people not away)
  median: number;
  ratio: number | null;
  badge: 'over' | 'under' | 'normal' | null;
  // Tasks closed per working day over the last four full weeks
  pace: number | null;
  // Working days until all open work is done at that pace
  runwayDays: number | null;
  // Closed per week, oldest first (same weeks as the team flow)
  weekly: number[] | null;
}

export interface TeamThresholds {
  // More tasks in progress at once than this is a warning
  wipLimit: number;
  // Working days in progress before a task counts as stuck
  staleDays: number;
  // Working days a PR may wait for its first review
  reviewWaitDays: number;
  // Working days of queue left before "runs out of work" shows
  runwayDays: number;
  off: SignalRule[];
}

export const DEFAULT_THRESHOLDS: TeamThresholds = {
  wipLimit: 2,
  staleDays: 5,
  reviewWaitDays: 2,
  runwayDays: 2,
  off: [],
};

export type TeamAway = Record<string, { until: string; note?: string | null }>;

// 1 задача, 2 задачи, 5 задач
const tasks = (n: number) => {
  const d = n % 10;
  const h = n % 100;
  const word =
    d === 1 && h !== 11
      ? 'задача'
      : d >= 2 && d <= 4 && (h < 12 || h > 14)
      ? 'задачи'
      : 'задач';
  return `${n} ${word}`;
};

const ruDate = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}`;
};

export const personSignals = (
  p: Omit<PersonView, 'signals' | 'name' | 'github' | 'away' | 'load'> & {
    load?: PersonLoad;
  },
  releaseVersion: string | null,
  now: Date,
  limits: TeamThresholds = DEFAULT_THRESHOLDS,
  away: PersonView['away'] = null,
  free: FreeIssue[] = [],
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
  const load = p.load;
  const offer = free.slice(0, 3);
  const offerKeys = offer.map((i) => i.key);
  const total = p.inProgress.length + p.queue.length;
  if (on('runway') && !total) {
    // Info, not a warning: leads, QA or people who left show up here too
    out.push({
      level: 'info',
      rule: 'runway',
      subject: 'load',
      text: 'Нет задач ни в работе, ни в очереди.',
      why: 'в работе 0, очередь 0',
      keys: offerKeys,
      say: offer.length
        ? `Что берёшь дальше? Свободные: ${offerKeys.join(', ')}.`
        : 'Над чем сейчас работаешь? В Jira на тебе нет задач.',
    });
  } else if (
    on('runway') &&
    load?.runwayDays != null &&
    load.runwayDays < limits.runwayDays
  ) {
    const days = Math.round(load.runwayDays * 10) / 10;
    out.push({
      level: 'info',
      rule: 'runway',
      subject: 'load',
      text: `Работы примерно на ${days} раб. дн. — пора планировать следующее.`,
      why: `открыто ${total} (в работе ${p.inProgress.length}, очередь ${
        p.queue.length
      }), темп ${load.pace?.toFixed(1)} задачи/день → ${days} < порог ${
        limits.runwayDays
      }`,
      keys: offerKeys,
      say: offer.length
        ? `Что берёшь после текущих? Предлагаю ${offerKeys[0]}.`
        : 'Что берёшь после текущих задач?',
    });
  }
  if (on('overload') && load?.badge === 'over') {
    const movable = p.queue.slice(0, 3);
    out.push({
      level: 'warn',
      rule: 'overload',
      subject: 'load',
      text: `Перегружен: ${tasks(total)} (в работе ${
        p.inProgress.length
      }, очередь ${p.queue.length}) — в ${load.ratio?.toFixed(
        1,
      )} раза больше медианы команды (${load.median}).`,
      why: `${total} ÷ медиана ${load.median} = ×${load.ratio?.toFixed(
        1,
      )} ≥ ×1.5`,
      keys: movable.map((i) => i.key),
      say: `У тебя сейчас больше всех задач — что из очереди можно отдать? Например, ${
        movable.map((i) => i.key).join(', ') || 'что-то из очереди'
      }.`,
    });
  }
  if (on('underload') && total && load?.badge === 'under') {
    out.push({
      level: 'info',
      rule: 'underload',
      subject: 'load',
      text: `Недогружен: ${tasks(total)} при медиане команды ${load.median}.`,
      why: `${total} ÷ медиана ${load.median} = ×${load.ratio?.toFixed(
        1,
      )} ≤ ×0.5`,
      keys: offerKeys,
      say: offer.length
        ? `Есть время взять ещё? Свободные: ${offerKeys.join(', ')}.`
        : 'Есть время взять ещё задачу или помочь кому-то?',
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
  runway: 50,
  overload: 45,
  underload: 35,
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
      const id = `${s.rule}|${p.name}|${s.subject ?? s.keys.join(',')}`;
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
  options: { thresholds?: Partial<TeamThresholds>; away?: TeamAway } = {},
): {
  asOf: Date;
  releaseVersion: string | null;
  capped: boolean;
  people: PersonView[];
  unmatchedGithub: string[];
  thresholds: TeamThresholds;
  // Team weekly closed / created, and whether more arrives than closes
  flow: WeeklyFlow | null;
  scopeGrowing: boolean;
  unassigned: FreeIssue[];
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
  // Stored thresholds from before a new field existed get its default
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const flow = issues?.flow ?? null;
  const today = now.toISOString().slice(0, 10);
  const used = new Set<string>();
  const drafts = Object.entries(issues?.people ?? {}).map(([name, work]) => {
    const github = githubLogins[name] ?? null;
    const gh = github ? authors[github] : undefined;
    if (github) used.add(github);
    const off = options.away?.[name];
    const away = off ? { until: off.until, note: off.note ?? null } : null;
    return {
      name,
      github,
      away,
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
  });
  const isAway = (d: (typeof drafts)[number]) =>
    Boolean(d.away && d.away.until >= today);
  // Only people with open work set the norm: a lead, QA or someone who left
  // closes a ticket now and then and would drag the median to zero
  const present = drafts.filter(
    (d) => !isAway(d) && d.inProgress.length + d.queue.length > 0,
  );
  const mid = median(present.map((d) => d.inProgress.length + d.queue.length));
  const unassigned = issues?.unassigned ?? [];
  const people = drafts
    .map((d) => {
      const total = d.inProgress.length + d.queue.length;
      const weekly = flow
        ? flow.people[d.name] ?? flow.weeks.map(() => 0)
        : null;
      // Without history, the 14-day count gives a rougher pace
      const pace = flow
        ? pacePerDay(weekly ?? undefined)
        : d.done14.length
        ? d.done14.length / 10
        : null;
      const ratio = mid ? total / mid : null;
      // Relative load means little in a team of one or two
      const badge: PersonLoad['badge'] =
        ratio === null || present.length < 3 || isAway(d)
          ? null
          : ratio >= 1.5 && total - mid >= 2
          ? 'over'
          : ratio <= 0.5
          ? 'under'
          : 'normal';
      const load: PersonLoad = {
        total,
        median: mid,
        ratio: ratio === null ? null : Math.round(ratio * 10) / 10,
        badge,
        pace: pace === null ? null : Math.round(pace * 100) / 100,
        runwayDays: pace ? total / pace : null,
        weekly,
      };
      const base = { ...d, load };
      return {
        ...base,
        signals: personSignals(
          base,
          issues?.releaseVersion ?? null,
          now,
          thresholds,
          d.away,
          unassigned,
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
    flow,
    scopeGrowing: flow ? scopeGrowing(flow) : false,
    unassigned,
    hasDetails: Boolean(issues),
  };
};
