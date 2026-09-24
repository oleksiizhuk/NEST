import {
  ProjectSnapshot,
  SnapshotSource,
} from '@domain/project-status/project-snapshot.entity';
import { ProjectSnapshotDocument } from '@infrastructure/database/schemas/project-snapshot.schema';

export class ProjectSnapshotMapper {
  static toDomain(doc: ProjectSnapshotDocument): ProjectSnapshot {
    return new ProjectSnapshot(
      String(doc._id),
      new Date(doc.createdAt),
      (doc.sections ?? []).map((s) => ({
        source: s.source as SnapshotSource,
        ok: Boolean(s.ok),
        fetchedAt: new Date(s.fetchedAt),
        text: s.text ?? '',
        error: s.error ?? null,
        ...(s.metrics ? { metrics: s.metrics } : {}),
        ...(s.signals ? { signals: s.signals } : {}),
        ...(s.details ? { details: s.details } : {}),
      })),
      doc.digest ?? null,
    );
  }
}
