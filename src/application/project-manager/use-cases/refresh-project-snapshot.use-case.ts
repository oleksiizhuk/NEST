import { Inject, Injectable, Logger } from '@nestjs/common';
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
} from '@application/project-manager/project-source.interface';

@Injectable()
export class RefreshProjectSnapshotUseCase {
  private readonly logger = new Logger(RefreshProjectSnapshotUseCase.name);

  constructor(
    @Inject(PROJECT_SOURCES) private readonly sources: IProjectSource[],
    @Inject(PROJECT_SNAPSHOT_REPOSITORY)
    private readonly snapshots: IProjectSnapshotRepository,
  ) {}

  // Sources are fetched in parallel; one failing never loses the others, and
  // a failed source keeps its previous text marked as stale.
  async execute(now = new Date()): Promise<ProjectSnapshot> {
    const previous = await this.snapshots.findLatest().catch(() => null);
    const configured = this.sources.filter((s) => s.isConfigured());

    const results = await Promise.allSettled(configured.map((s) => s.fetch()));
    const sections: SnapshotSection[] = configured.map((source, i) => {
      const result = results[i];
      if (result.status === 'fulfilled') {
        return {
          source: source.source,
          ok: true,
          fetchedAt: now,
          text: result.value,
          error: null,
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
        error,
      };
    });

    const snapshot = await this.snapshots.save(sections);
    this.logger.log(
      `Snapshot saved: ${sections
        .map((s) => `${s.source}=${s.ok ? s.text.length : 'failed'}`)
        .join(' ')}`,
    );
    return snapshot;
  }
}
