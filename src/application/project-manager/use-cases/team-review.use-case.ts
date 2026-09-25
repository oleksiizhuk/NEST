import { Inject, Injectable } from '@nestjs/common';
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
import { buildTeam, PersonView } from '@application/project-manager/team';
import { FlowStages } from '@application/project-manager/stages';
import {
  ITeamReviews,
  PM_TEAM_REVIEWS,
} from '@application/project-manager/team-reviews.interface';

export const TEAM_REVIEW_REQUEST =
  'Prepare notes for my next team meeting, in Russian, for me as the team lead. ' +
  'For each person below: (1) what they are working on now, one line; ' +
  '(2) is it the right direction given the release scope, priorities and dates — say "да", "частично" or "нет" and why, citing ticket keys; ' +
  '(3) one or two concrete recommendations I can give them at the meeting. ' +
  'Then up to three points for the whole team (focus, risks, who needs help). ' +
  'Use only the data below and the snapshot; if something is unknown, say so. Plain text, short lines, no tables.';

const DAY = (d: Date) => d.toISOString().slice(0, 10);

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
  constructor(
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IProjectSnapshotRepository,
    @Inject(PM_AI_SERVICE) private readonly ai: IProjectManagerAiService,
    @Inject(PM_KNOWLEDGE) private readonly knowledge: IKnowledgeStore,
    @Inject(PM_TEAM_REVIEWS) private readonly reviews: ITeamReviews,
    private readonly runtime: PmRuntimeConfig,
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
    };
  }

  async latest() {
    return this.reviews.latest();
  }

  async review(force: boolean, now = new Date()) {
    const cached = await this.reviews.latest();
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
      )}\n\n${TEAM_REVIEW_REQUEST}\n\nRelease version: ${
        team.releaseVersion ?? 'not set (all open work counts)'
      }${
        team.capped ? ' (Jira lists were capped: counts are lower bounds)' : ''
      }\n\n${team.people.map(describe).join('\n\n')}`,
      deadline: Date.now() + 240_000,
    });
    if (!text || text === PM_UNAVAILABLE_REPLY)
      throw new Error('Модель не смогла подготовить разбор. Попробуйте позже.');
    await this.reviews.save(text, now);
    return { text, at: now };
  }
}
