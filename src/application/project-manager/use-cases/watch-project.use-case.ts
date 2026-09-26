import { PmRuntimeConfig } from '@application/project-manager/pm-runtime-config';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  IProjectSnapshotRepository,
  PROJECT_SNAPSHOT_REPOSITORY,
} from '@domain/project-status/project-snapshot.repository.interface';
import { ProjectSnapshot } from '@domain/project-status/project-snapshot.entity';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import {
  ITelegramGateway,
  TELEGRAM_GATEWAY,
} from '@application/telegram/telegram.gateway.interface';
import {
  ITelegramConfig,
  TELEGRAM_CONFIG,
} from '@application/telegram/telegram.config.interface';
import {
  IAlertLog,
  PM_ALERT_LOG,
} from '@application/project-manager/alert-log.interface';
import {
  IPmMemory,
  PM_MEMORY,
} from '@application/project-manager/memory.interface';
import {
  DESIGN_HOST,
  DOC_COMMENTS,
  IDesignHost,
  IDocComments,
  IIssueDetails,
  ISSUE_DETAILS,
  Remark,
} from '@application/project-manager/collaboration.interface';
import {
  IKnowledgeStore,
  PM_KNOWLEDGE,
} from '@application/project-manager/knowledge.interface';
import { Signal } from '@application/project-manager/project-source.interface';
import { RefreshProjectSnapshotUseCase } from '@application/project-manager/use-cases/refresh-project-snapshot.use-case';
import {
  workingDaysBetween,
  workingDaysLeft,
} from '@application/project-manager/release-clock';
import {
  isAnswered,
  isTeamMember,
  looksLikeQuestion,
} from '@application/project-manager/tools/open-questions';
import { readinessChecklist } from '@application/project-manager/readiness';
import { buildTeam } from '@application/project-manager/team';
import {
  ReleaseIssues,
  releaseView,
} from '@application/project-manager/release';
import { WeeklyFlow } from '@application/project-manager/load';

const RULES: Array<[string, string]> = [
  ['readiness', 'Готовность релиза'],
  ['blocker', 'Блокеры'],
  ['release-unassigned', 'Задачи высокого приоритета без исполнителя'],
  ['red-pipeline', 'Красные пайплайны'],
  ['client-question', 'Вопросы без ответа команды'],
  ['commitment-overdue', 'Просроченные обещания'],
  ['review-wait', 'PR ждут ревью'],
  ['release-forecast', 'Прогноз релиза'],
  ['person-overload', 'Перегружены'],
  ['person-stuck', 'Застрявшие задачи'],
  ['person-handover', 'Передать на время отсутствия'],
  ['person-idle', 'Без задач'],
];

// About people: only for the owner's private chats, never a group
const PERSONAL = /^person-/;
const PER_RULE = 8;
const QUESTION_DAYS = 14;
const QUESTION_WAIT_DAYS = 2;
const READINESS_DAYS = [5, 2, 1];
const SOURCE_BUDGET_MS = 12_000;

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('too slow')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

const keyOf = (s: Signal): string => `${s.rule}:${s.subject}`;

export const formatAlerts = (signals: Signal[], waiting = 0): string => {
  const parts = RULES.map(([rule, title]) => {
    const items = signals.filter((s) => s.rule === rule);
    if (!items.length) return '';
    return `${title}:\n${items.map((s) => `- ${s.text}`).join('\n')}`;
  }).filter(Boolean);
  return `🔔 Новое по проекту\n\n${parts.join('\n\n')}${
    waiting ? `\n\nЕщё ${waiting} — в следующих уведомлениях.` : ''
  }`;
};

// Proactive alerts: rules checked in code on fresh data, each event sent
// once per chat. No model call — the message is the list of events.
@Injectable()
export class WatchProjectUseCase {
  private readonly logger = new Logger(WatchProjectUseCase.name);

  constructor(
    private readonly refresh: RefreshProjectSnapshotUseCase,
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IProjectSnapshotRepository,
    @Inject(TELEGRAM_GATEWAY) private readonly telegram: ITelegramGateway,
    @Inject(PM_CONFIG) private readonly config: IPmConfig,
    @Inject(PM_ALERT_LOG) private readonly alerts: IAlertLog,
    @Inject(PM_KNOWLEDGE) private readonly knowledge: IKnowledgeStore,
    @Optional() @Inject(PM_MEMORY) private readonly memory?: IPmMemory,
    @Optional() @Inject(ISSUE_DETAILS) private readonly issues?: IIssueDetails,
    @Optional() @Inject(DOC_COMMENTS) private readonly docs?: IDocComments,
    @Optional() @Inject(DESIGN_HOST) private readonly design?: IDesignHost,
    @Optional() private readonly runtime?: PmRuntimeConfig,
    @Optional()
    @Inject(TELEGRAM_CONFIG)
    private readonly telegramConfig?: ITelegramConfig,
  ) {}

  // dry: read the latest snapshot, send and record nothing
  async execute(
    now = new Date(),
    dry = false,
  ): Promise<{ signals: Signal[]; sent: Record<string, number> }> {
    const snapshot = dry
      ? await this.snapshots.findLatest()
      : await this.refresh.execute(now);
    if (!snapshot) return { signals: [], sent: {} };

    const signals = [
      ...(await this.readiness(snapshot, now)),
      // Stale sections (a failed source) raise nothing
      ...snapshot.sections.filter((s) => s.ok).flatMap((s) => s.signals ?? []),
      ...(await this.questions(now)),
      ...(await this.overdueCommitments(now)),
      ...(await this.teamSignals(snapshot, now)),
    ];
    const sent: Record<string, number> = {};
    if (dry) return { signals, sent };

    const codeFresh = Boolean(snapshot.section('code')?.ok);
    const live =
      (await this.runtime?.current().catch(() => undefined)) ?? this.config;
    for (const chatId of live.alertChatIds ?? []) {
      // A pipeline that is green again may alert again when it next breaks
      if (codeFresh) {
        await this.alerts
          .releaseStale(
            chatId,
            'red-pipeline:',
            signals.filter((s) => s.rule === 'red-pipeline').map(keyOf),
          )
          .catch((error) => this.logger.error(`release stale: ${error}`));
      }
      const fresh: Signal[] = [];
      let waiting = 0;
      const perRule = new Map<string, number>();
      for (const signal of signals) {
        // About people: the owner's own chat only, never a group or a
        // teammate on the alert list
        if (
          PERSONAL.test(signal.rule) &&
          chatId !== this.telegramConfig?.ownerId
        )
          continue;
        const shown = perRule.get(signal.rule) ?? 0;
        if (shown >= PER_RULE) {
          waiting += 1;
          continue;
        }
        if (await this.alerts.claim(chatId, keyOf(signal), now)) {
          fresh.push(signal);
          perRule.set(signal.rule, shown + 1);
        }
      }
      if (!fresh.length) continue;
      try {
        await this.telegram.sendMessage(chatId, formatAlerts(fresh, waiting));
        sent[chatId] = fresh.length;
      } catch (error) {
        this.logger.error(`alerts to ${chatId}: ${error}`);
        // Not delivered: let the next run try again
        await this.alerts
          .release(chatId, fresh.map(keyOf))
          .catch(() => undefined);
      }
    }
    return { signals, sent };
  }

  // Person-level and release-forecast alerts from the admin's own numbers
  private async teamSignals(
    snapshot: ProjectSnapshot,
    now: Date,
  ): Promise<Signal[]> {
    try {
      const live =
        (await this.runtime?.current().catch(() => undefined)) ?? this.config;
      const team = buildTeam(snapshot, live.githubLogins ?? {}, now, {
        thresholds: live.teamThresholds,
        away: live.teamAway,
      });
      const out: Signal[] = [];
      for (const p of team.people) {
        for (const s of p.signals) {
          if (s.rule === 'overload')
            out.push({
              rule: 'person-overload',
              subject: p.name,
              text: `${p.name}: ${s.text}`,
            });
          else if (s.rule === 'stale')
            out.push({
              rule: 'person-stuck',
              subject: `${p.name}:${s.keys[0] ?? ''}`,
              text: `${p.name}: ${s.text}`,
            });
          else if (s.rule === 'handover')
            out.push({
              rule: 'person-handover',
              subject: `${p.name}:${p.away?.until ?? ''}`,
              text: `${p.name}: ${s.text}`,
            });
          else if (s.rule === 'runway' && p.load.total === 0 && p.load.pace)
            out.push({
              rule: 'person-idle',
              subject: p.name,
              text: `${p.name}: ${s.text}`,
            });
        }
      }
      const issues = snapshot.section('issues')?.details as
        | { release?: ReleaseIssues | null; flow?: WeeklyFlow | null }
        | undefined;
      if (issues?.release && !issues.release.error && live.releaseDate) {
        const r = releaseView(issues.release, now, {
          releaseDate: live.releaseDate,
          flow: issues.flow ?? null,
        });
        if (r.eta.verdict === 'late' || r.eta.verdict === 'at-risk')
          out.push({
            rule: 'release-forecast',
            // The date moves every day at a steady pace; alert again only
            // when the verdict or the slip in whole weeks changes
            subject: `${r.version}:${r.eta.verdict}:${
              r.eta.date ? Math.ceil((r.eta.daysLate ?? 0) / 5) : 'none'
            }`,
            text: r.eta.date
              ? `Релиз ${r.version}: прогноз ${r.eta.date} при цели ${
                  live.releaseDate
                }${
                  r.eta.daysLate ? `, позже на ${r.eta.daysLate} раб. дн.` : ''
                } — ${r.eta.verdict === 'late' ? 'опаздываем' : 'под риском'}.`
              : `Релиз ${r.version}: за две недели ничего не закрыто, прогноза нет.`,
          });
      }
      return out;
    } catch (error) {
      this.logger.error(`team alerts: ${error}`);
      return [];
    }
  }

  private async readiness(
    snapshot: ProjectSnapshot,
    now: Date,
  ): Promise<Signal[]> {
    const release = this.config.releaseDate;
    if (!release) return [];
    const left = workingDaysLeft(now, release);
    if (!READINESS_DAYS.includes(left)) return [];
    const dod =
      (await this.knowledge.all().catch(() => [])).find(
        (d) => d.key === 'core:dod',
      )?.text ?? null;
    return [
      {
        rule: 'readiness',
        subject: `${release}:T-${left}`,
        text: `До релиза ${left} раб. дн.\n${readinessChecklist(
          snapshot,
          dod,
        )}`,
      },
    ];
  }

  // Questions from people outside the team that nobody on the team answered
  // for more than two working days. Needs the team roster to tell who is
  // the client.
  private async questions(now: Date): Promise<Signal[]> {
    const team = this.config.team;
    if (!team.length) return [];
    const readers = [this.issues, this.docs, this.design].filter(
      (r): r is IIssueDetails | IDocComments | IDesignHost =>
        Boolean(r?.isConfigured()),
    );
    const results = await Promise.all(
      readers.map((r) =>
        withTimeout(r.recentComments(QUESTION_DAYS), SOURCE_BUDGET_MS).catch(
          () => [] as Remark[],
        ),
      ),
    );
    return results
      .flat()
      .filter(
        (r) =>
          !isTeamMember(r.author, team) &&
          looksLikeQuestion(r.text) &&
          !isAnswered(r, team) &&
          workingDaysBetween(r.createdAt, now) > QUESTION_WAIT_DAYS,
      )
      .map((r) => ({
        rule: 'client-question',
        subject: `${r.source}:${
          r.link ?? r.where
        }:${r.createdAt.toISOString()}`,
        text: `${r.author} · ${r.where} · ${workingDaysBetween(
          r.createdAt,
          now,
        )} раб. дн.: «${r.text.replace(/\s+/g, ' ').slice(0, 150)}»${
          r.link ? `\n  ${r.link}` : ''
        }`,
      }));
  }

  private async overdueCommitments(now: Date): Promise<Signal[]> {
    const records = (await this.memory?.active(now).catch(() => [])) ?? [];
    return records
      .filter((r) => r.kind === 'commitment' && r.dueAt && r.dueAt < now)
      .map((r) => ({
        rule: 'commitment-overdue',
        subject: r.id,
        text: `${r.text} (срок ${r.dueAt
          ?.toISOString()
          .slice(0, 10)}, записал ${r.author}; /forget ${r.id} если закрыто)`,
      }));
  }
}
