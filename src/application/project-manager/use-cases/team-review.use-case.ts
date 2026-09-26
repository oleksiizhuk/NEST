import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  IProjectSnapshotRepository,
  PROJECT_SNAPSHOT_REPOSITORY,
} from '@domain/project-status/project-snapshot.repository.interface';
import {
  IProjectManagerAiService,
  PM_AI_SERVICE,
  PM_UNAVAILABLE_REPLY,
} from '@application/project-manager/project-manager-ai.interface';
import {
  IKnowledgeStore,
  PM_KNOWLEDGE,
} from '@application/project-manager/knowledge.interface';
import { loadKnowledge } from '@application/project-manager/knowledge-loader';
import { PmRuntimeConfig } from '@application/project-manager/pm-runtime-config';
import { todayLine } from '@application/project-manager/release-clock';
import {
  buildTeam,
  PersonView,
  TeamCode,
} from '@application/project-manager/team';
import { FlowStages } from '@application/project-manager/stages';
import {
  ReleaseIssues,
  releaseView,
} from '@application/project-manager/release';
import { WeeklyFlow } from '@application/project-manager/load';
import { ReviewLoad } from '@application/project-manager/reviews';
import { Areas } from '@application/project-manager/areas';
import {
  DayLoad,
  dayLoad,
  ITeamHistory,
  PM_TEAM_HISTORY,
} from '@application/project-manager/team-history';
import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import {
  ITeamReviews,
  PM_TEAM_REVIEWS,
  ReviewKind,
} from '@application/project-manager/team-reviews.interface';

export const TEAM_REVIEW_REQUEST =
  'Prepare notes for my next team meeting, in Russian, for me as the team lead. ' +
  'For each person below: (1) what they are working on now, one line; ' +
  '(2) is it the right direction given the release scope, priorities and dates — say "да", "частично" or "нет" and why, citing ticket keys; ' +
  '(3) one or two concrete recommendations I can give them at the meeting. ' +
  'Then up to three points for the whole team (focus, risks, who needs help). ' +
  'Use only the data below and the snapshot; if something is unknown, say so. Plain text, short lines, no tables.';

export const STANDUP_REQUEST =
  'Prepare a 5-minute standup agenda in Russian for me as the team lead. ' +
  'For each person one line: what they are on now and a blocker if the data shows one (cite ticket keys). ' +
  'Then the three things to unblock today, most important first. ' +
  'Use only the data below; plain text, short lines, no tables.';

export const RETRO_REQUEST =
  'Prepare a retrospective of the last two weeks in Russian for me as the team lead. ' +
  'Sections: (1) what went well, with numbers from the data; (2) what slowed us — stages where work waited, work sent back, blocked time, handoffs, scope growth; ' +
  '(3) three questions to discuss with the team; (4) two concrete experiments for the next two weeks. ' +
  'Talk about the process, never blame a person. Use only the data below; plain text, no tables.';

export const ONE_ON_ONE_REQUEST =
  'Prepare an agenda for my one-to-one meeting with the person below, in Russian. ' +
  'Start with up to three wins (closed tickets, merged work). Then up to two friction points, each phrased as an open question, not a verdict. ' +
  'Then one growth topic and one question about workload and how they feel about it. ' +
  'Do not guess motivation or mood, give no ratings, do not compare them with others. Use only the data below; plain text, short lines.';

const DAY = (d: Date) => d.toISOString().slice(0, 10);

// Numbers from the Поток data for the retro
const flowLines = (stages: FlowStages | null | undefined): string => {
  if (!stages) return 'Flow data: not collected yet.';
  const m = stages.stageMedians;
  return [
    `Flow over ${stages.windowDays} days: ${
      stages.finished
    } finished; median working days per stage — dev ${m.dev ?? '?'}, review ${
      m.review ?? '?'
    }, QA ${m.qa ?? '?'}, blocked ${m.blocked ?? '?'}; cycle time p50 ${
      stages.cycle.p50 ?? '?'
    }, p85 ${stages.cycle.p85 ?? '?'}.`,
    `Sent back: ${stages.bounces.count} of ${
      stages.bounces.total
    } tickets that moved (${
      Object.entries(stages.bounces.from)
        .map(([k, v]) => `from ${k} ${v}`)
        .join(', ') || 'none'
    }); reopened ${stages.bounces.reopened}.`,
    `Blocked: ${stages.blocked.daysInWindow} working days in total; handoffs: ${
      stages.handoffs.pairs
        .slice(0, 5)
        .map((p) => `${p.from}→${p.to} ×${p.count}`)
        .join(', ') || 'none'
    }.`,
  ].join('\n');
};

const describe = (p: PersonView): string =>
  [
    `## ${p.name}${p.github ? ` (GitHub ${p.github})` : ''}`,
    `In progress: ${
      p.inProgress
        .map(
          (i) =>
            `${i.key} [${i.priority ?? '-'}, ${i.days ?? '?'} working days, ${
              i.inScope ? 'in release' : 'not in release'
            }${i.blocked ? ', blocked' : ''}] ${i.summary}`,
        )
        .join('; ') || 'nothing'
    }`,
    `Queue (top 5): ${
      p.queue
        .slice(0, 5)
        .map(
          (i) =>
            `${i.key} [${i.priority ?? '-'}${i.inScope ? ', release' : ''}] ${
              i.summary
            }`,
        )
        .join('; ') || 'empty'
    }`,
    `Done in 14 days: ${p.done14.length}${
      p.done14.length
        ? ` (${p.done14
            .slice(0, 8)
            .map((d) => d.key)
            .join(', ')})`
        : ''
    }`,
    `Open PRs: ${
      p.pulls
        .map((x) => `${x.repo}#${x.number} ${x.review}, ${x.waitingDays}d`)
        .join('; ') || (p.github ? 'none' : 'GitHub login not linked')
    }; merged in 14 days: ${p.merged14.length}`,
    `Load: ${p.load.total} open (team median ${p.load.median}${
      p.load.badge ? `, ${p.load.badge}` : ''
    }); pace ${
      p.load.pace === null ? 'unknown' : `${p.load.pace} tasks/working day`
    }${
      p.load.weekly
        ? `; closed per week, oldest first: ${p.load.weekly.join(' ')}`
        : ''
    }${p.away ? `; away until ${p.away.until}` : ''}`,
    `Computed signals: ${p.signals.map((s) => s.text).join(' ')}`,
  ].join('\n');

// Meeting notes about each person, written by the model from the computed
// per-person data. Cached for the day; "force" writes a fresh one.
@Injectable()
export class TeamReviewUseCase {
  private readonly logger = new Logger(TeamReviewUseCase.name);

  constructor(
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IProjectSnapshotRepository,
    @Inject(PM_AI_SERVICE) private readonly ai: IProjectManagerAiService,
    @Inject(PM_KNOWLEDGE) private readonly knowledge: IKnowledgeStore,
    @Inject(PM_TEAM_REVIEWS) private readonly reviews: ITeamReviews,
    private readonly runtime: PmRuntimeConfig,
    @Optional()
    @Inject(PM_TEAM_HISTORY)
    private readonly history?: ITeamHistory,
  ) {}

  async team(now = new Date()) {
    const snapshot = await this.snapshots.findLatest();
    if (!snapshot) return null;
    const live = await this.runtime.current();
    return {
      ...buildTeam(snapshot, live.githubLogins ?? {}, now, {
        thresholds: live.teamThresholds,
        away: live.teamAway,
      }),
      links: { jira: live.jiraUrl ?? null, githubOrg: live.githubOrg ?? null },
      telegram: live.telegramUsernames ?? {},
      // Per GitHub login: reviews given in 30 days and requests waiting
      reviewers: Object.fromEntries(
        (this.reviewsOf(snapshot)?.reviewers ?? []).map((r) => [
          r.login,
          { reviewed: r.reviewed, pending: r.pending },
        ]),
      ),
    };
  }

  // Поток: where work waits, from the latest snapshot's status history
  async flow() {
    const snapshot = await this.snapshots.findLatest();
    if (!snapshot) return null;
    const live = await this.runtime.current();
    const details = snapshot.section('issues')?.details as
      | { stages?: FlowStages | null }
      | undefined;
    const stages = details?.stages ?? null;
    return {
      asOf: snapshot.createdAt,
      links: { jira: live.jiraUrl ?? null, githubOrg: live.githubOrg ?? null },
      // The per-ticket dates are only needed at refresh
      stages: stages ? { ...stages, lastChange: undefined } : null,
      reviews: this.reviewsOf(snapshot),
      // GitHub login → Jira name, to show people by the names used elsewhere
      names: Object.fromEntries(
        Object.entries(live.githubLogins ?? {}).map(([name, login]) => [
          login,
          name,
        ]),
      ),
    };
  }

  // Релиз: forecast, scope growth, critical path, people, Jira vs code
  async release(now = new Date()) {
    const snapshot = await this.snapshots.findLatest();
    if (!snapshot) return null;
    const live = await this.runtime.current();
    const issues = snapshot.section('issues')?.details as
      | { release?: ReleaseIssues | null; flow?: WeeklyFlow | null }
      | undefined;
    const code = snapshot.section('code')?.details as unknown as
      | TeamCode
      | undefined;
    return {
      asOf: snapshot.createdAt,
      links: { jira: live.jiraUrl ?? null, githubOrg: live.githubOrg ?? null },
      hasCode: Boolean(code),
      releaseError: issues?.release?.error ?? null,
      release:
        issues?.release && !issues.release.error
          ? releaseView(issues.release, now, {
              releaseDate: live.releaseDate,
              baseline: live.releaseBaseline ?? null,
              code: code ?? null,
              flow: issues.flow ?? null,
            })
          : null,
    };
  }

  async latest() {
    return this.reviews.latest();
  }

  // Load per person per day for the heatmap; days before the history
  // existed are filled once from the stored snapshots (kept 21 days)
  async teamHistory(now = new Date(), days = 28) {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const list = Array.from({ length: days }, (_, n) =>
      day(new Date(now.getTime() - (days - 1 - n) * 86_400_000)),
    );
    let stored: DayLoad[] | null = null;
    if (this.history)
      stored = await this.history.since(list[0]).catch(() => null);
    const byDay = new Map((stored ?? []).map((d) => [d.day, d]));
    // Fill from snapshots only when the store answered; a day that cannot
    // be filled is saved empty so the next open does not look again
    if (stored && this.history)
      for (const d of list.slice(-21)) {
        if (byDay.has(d)) continue;
        const next = new Date(`${d}T00:00:00Z`).getTime() + 86_400_000;
        const snap = await this.snapshots
          .findLatestBefore(new Date(next))
          .catch(() => undefined);
        if (snap === undefined) continue;
        const load = (snap && day(snap.createdAt) === d && dayLoad(snap)) || {
          day: d,
          people: {},
        };
        byDay.set(d, load);
        await this.history
          .save(load)
          .catch((error) => this.logger.error(`history backfill: ${error}`));
      }
    const names = new Set<string>();
    for (const d of byDay.values())
      Object.keys(d.people).forEach((n) => names.add(n));
    return {
      days: list,
      people: [...names].sort().map((name) => ({
        name,
        // A day with data but without this person means nothing open and
        // nothing closed lately: zero, not "no data"
        days: list.map((d) => {
          const row = byDay.get(d);
          if (!row || !Object.keys(row.people).length) return null;
          return row.people[name] ?? { inProgress: 0, queue: 0, closed14: 0 };
        }),
      })),
    };
  }

  // Качество: bugs and single-owner risk by area
  async areas() {
    const snapshot = await this.snapshots.findLatest();
    if (!snapshot) return null;
    const live = await this.runtime.current();
    const areas =
      (
        snapshot.section('issues')?.details as
          | { areas?: Areas | null }
          | undefined
      )?.areas ?? null;
    return {
      asOf: snapshot.createdAt,
      links: { jira: live.jiraUrl ?? null, githubOrg: live.githubOrg ?? null },
      // Per-person counts stay on the cards, not in an area table
      areas: areas
        ? {
            // The main closer is named only where it is a risk
            areas: areas.areas.map((a) =>
              a.busRisk ? a : { ...a, owner: null, backup: null },
            ),
            noAreaShare: areas.noAreaShare,
            capped: areas.capped ?? false,
          }
        : null,
    };
  }

  private reviewsOf(snapshot: ProjectSnapshot): ReviewLoad | null {
    return (
      (
        snapshot.section('code')?.details as
          | { reviews?: ReviewLoad | null }
          | undefined
      )?.reviews ?? null
    );
  }

  async latestOf(kind: ReviewKind) {
    return this.reviews.latest(kind);
  }

  async review(force: boolean, now = new Date(), kind: ReviewKind = 'meeting') {
    const cached = await this.reviews.latest(kind);
    if (!force && cached && DAY(cached.at) === DAY(now)) return cached;
    const snapshot = await this.snapshots.findLatest();
    if (!snapshot) throw new Error('Нет снимка проекта: обновите данные.');
    const live = await this.runtime.current();
    const team = buildTeam(snapshot, live.githubLogins ?? {}, now, {
      thresholds: live.teamThresholds,
      away: live.teamAway,
    });
    if (!team.hasDetails)
      throw new Error(
        'В снимке ещё нет данных по людям: нажмите «Обновить данные сейчас».',
      );
    if (!team.people.length) throw new Error('В данных Jira нет исполнителей.');
    const who = kind.startsWith('oneonone:')
      ? team.people.find((p) => p.name === kind.slice('oneonone:'.length))
      : null;
    if (kind.startsWith('oneonone:') && !who)
      throw new Error('Такого человека нет в данных Jira.');
    const request =
      kind === 'standup'
        ? STANDUP_REQUEST
        : kind === 'retro'
        ? RETRO_REQUEST
        : who
        ? ONE_ON_ONE_REQUEST
        : TEAM_REVIEW_REQUEST;
    const stages = (
      snapshot.section('issues')?.details as
        | { stages?: FlowStages | null }
        | undefined
    )?.stages;
    const body = who
      ? describe(who)
      : `${team.people.map(describe).join('\n\n')}${
          kind === 'retro' ? `\n\n${flowLines(stages)}` : ''
        }`;
    const knowledge = await loadKnowledge(
      this.knowledge,
      live.knowledgeInlineChars,
    );
    const text = await this.ai.digest({
      brief: knowledge.brief ?? live.projectBrief,
      knowledge: knowledge.text,
      snapshot: snapshot.render(),
      question: `${todayLine(
        now,
        live.releaseDate,
      )}\n\n${request}\n\nRelease version: ${
        team.releaseVersion ?? 'not set (all open work counts)'
      }${
        team.capped ? ' (Jira lists were capped: counts are lower bounds)' : ''
      }\n\n${body}`,
      deadline: Date.now() + 240_000,
    });
    if (!text || text === PM_UNAVAILABLE_REPLY)
      throw new Error('Модель не смогла подготовить разбор. Попробуйте позже.');
    await this.reviews.save(text, now, kind);
    return { text, at: now };
  }
}
