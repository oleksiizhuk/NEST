import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  IProjectSnapshotRepository,
  PROJECT_SNAPSHOT_REPOSITORY,
} from '@domain/project-status/project-snapshot.repository.interface';
import {
  ProjectSnapshot,
  SnapshotSection,
} from '@domain/project-status/project-snapshot.entity';
import {
  IProjectSource,
  PROJECT_SOURCES,
  SourceResult,
} from '@application/project-manager/project-source.interface';
import { trendLine } from '@application/project-manager/metrics';
import {
  dayLoad,
  ITeamHistory,
  PM_TEAM_HISTORY,
} from '@application/project-manager/team-history';

const DAY_MS = 86_400_000;

const asResult = (value: string | SourceResult): SourceResult =>
  typeof value === 'string' ? { text: value } : value;

@Injectable()
export class RefreshProjectSnapshotUseCase {
  private readonly logger = new Logger(RefreshProjectSnapshotUseCase.name);

  constructor(
    @Inject(PROJECT_SOURCES) private readonly sources: IProjectSource[],
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IProjectSnapshotRepository,
    @Optional()
    @Inject(PM_TEAM_HISTORY)
    private readonly history?: ITeamHistory,
  ) {}

  // Sources are fetched in parallel; one failing never loses the others, and
  // a failed source keeps its previous text marked as stale.
  async execute(now = new Date()): Promise<ProjectSnapshot> {
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [previous, yesterday, weekAgo] = await Promise.all([
      this.snapshots.findLatest().catch(() => null),
      // Baselines for trends: the last snapshot of an earlier day, and the
      // last one at least a week old
      this.snapshots.findLatestBefore(startOfDay).catch(() => null),
      this.snapshots
        .findLatestBefore(new Date(now.getTime() - 7 * DAY_MS))
        .catch(() => null),
    ]);
    const configured = this.sources.filter((s) => s.isConfigured());

    const results = await Promise.allSettled(configured.map((s) => s.fetch()));
    const sections: SnapshotSection[] = configured.map((source, i) => {
      const result = results[i];
      if (result.status === 'fulfilled') {
        const { text, metrics, signals, details } = asResult(result.value);
        const trends = metrics
          ? [yesterday, weekAgo]
              .filter((base): base is ProjectSnapshot => Boolean(base))
              .map(
                (base) =>
                  `Since ${base.createdAt
                    .toISOString()
                    .slice(0, 10)}: ${trendLine(
                    metrics,
                    base.section(source.source)?.metrics,
                  )}`,
              )
          : [];
        return {
          source: source.source,
          ok: true,
          fetchedAt: now,
          text: trends.length
            ? `## Trend (computed)\n${[...new Set(trends)].join(
                '\n',
              )}\n\n${text}`
            : text,
          error: null,
          ...(metrics ? { metrics } : {}),
          ...(signals?.length ? { signals } : {}),
          ...(details ? { details } : {}),
        };
      }
      const error = String((result.reason as Error)?.message ?? result.reason);
      this.logger.error(`${source.source} source failed: ${error}`);
      const old = previous?.section(source.source);
      return {
        source: source.source,
        ok: false,
        fetchedAt: old?.fetchedAt ?? now,
        text: old?.text ?? '',
        // The old numbers describe the old text; keeping them lets tomorrow's
        // trend compare against the last real reading
        ...(old?.metrics ? { metrics: old.metrics } : {}),
        // Same for per-person data: an empty team page (or "nothing merged"
        // for everyone) would be worse than yesterday's
        ...(old?.details ? { details: old.details } : {}),
        error,
      };
    });

    const snapshot = await this.snapshots.save(sections);
    // Per-person load for the day; never fails the refresh
    const day = dayLoad(snapshot);
    if (day && this.history)
      await this.history
        .save(day)
        .catch((error) => this.logger.error(`team history: ${error}`));
    this.logger.log(
      `Snapshot saved: ${sections
        .map((s) => `${s.source}=${s.ok ? s.text.length : 'failed'}`)
        .join(' ')}`,
    );
    return snapshot;
  }
}
