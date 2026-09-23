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
  looksLikeQuestion,
} from '@application/project-manager/tools/open-questions';
import { readinessChecklist } from '@application/project-manager/readiness';

const RULES: Array<[string, string]> = [
  ['readiness', 'Готовность релиза'],
  ['blocker', 'Блокеры'],
  ['release-unassigned', 'Задачи высокого приоритета без исполнителя'],
  ['red-pipeline', 'Красные пайплайны'],
  ['client-question', 'Вопросы без ответа команды'],
  ['commitment-overdue', 'Просроченные обещания'],
  ['review-wait', 'PR ждут ревью'],
];
const PER_RULE = 8;
const QUESTION_DAYS = 14;
const QUESTION_WAIT_DAYS = 2;
const READINESS_DAYS = [5, 2, 1];
const SOURCE_BUDGET_MS = 12_000;

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('too slow')), ms),
    ),
  ]);

export const formatAlerts = (signals: Signal[]): string => {
  const parts = RULES.map(([rule, title]) => {
    const items = signals.filter((s) => s.rule === rule);
    if (!items.length) return '';
    const lines = items.slice(0, PER_RULE).map((s) => `- ${s.text}`);
    if (items.length > PER_RULE)
      lines.push(`…и ещё ${items.length - PER_RULE}`);
    return `${title}:\n${lines.join('\n')}`;
  }).filter(Boolean);
  return `🔔 Новое по проекту\n\n${parts.join('\n\n')}`;
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
    ];
    const sent: Record<string, number> = {};
    if (dry) return { signals, sent };

    for (const chatId of this.config.alertChatIds ?? []) {
      const fresh: Signal[] = [];
      for (const signal of signals) {
        if (
          await this.alerts.claim(
            chatId,
            `${signal.rule}:${signal.subject}`,
            now,
          )
        ) {
          fresh.push(signal);
        }
      }
      if (!fresh.length) continue;
      try {
        await this.telegram.sendMessage(chatId, formatAlerts(fresh));
        sent[chatId] = fresh.length;
      } catch (error) {
        this.logger.error(`alerts to ${chatId}: ${error}`);
      }
    }
    return { signals, sent };
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
    const inTeam = (name: string) =>
      team.some((m) => name.toLowerCase().includes(m.toLowerCase()));
    return results
      .flat()
      .filter(
        (r) =>
          !inTeam(r.author) &&
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
