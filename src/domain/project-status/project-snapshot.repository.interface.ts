import {
  ProjectSnapshot,
  SnapshotSection,
} from '@domain/project-status/project-snapshot.entity';

export const PROJECT_SNAPSHOT_REPOSITORY = 'PROJECT_SNAPSHOT_REPOSITORY';

export interface IProjectSnapshotRepository {
  save(sections: SnapshotSection[]): Promise<ProjectSnapshot>;
  findLatest(): Promise<ProjectSnapshot | null>;
  // Newest snapshot created strictly before `date`
  findLatestBefore(date: Date): Promise<ProjectSnapshot | null>;
  saveDigest(id: string, text: string): Promise<void>;
  // Newest snapshot before `date` that has a digest
  findLastDigest(
    before: Date,
  ): Promise<{ createdAt: Date; text: string } | null>;
}
