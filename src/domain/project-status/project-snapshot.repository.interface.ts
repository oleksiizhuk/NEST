import {
  ProjectSnapshot,
  SnapshotSection,
} from '@domain/project-status/project-snapshot.entity';

export const PROJECT_SNAPSHOT_REPOSITORY = 'PROJECT_SNAPSHOT_REPOSITORY';

export interface IProjectSnapshotRepository {
  save(sections: SnapshotSection[]): Promise<ProjectSnapshot>;
  findLatest(): Promise<ProjectSnapshot | null>;
}
