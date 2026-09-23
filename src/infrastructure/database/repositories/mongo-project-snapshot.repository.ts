import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IProjectSnapshotRepository } from '@domain/project-status/project-snapshot.repository.interface';
import {
  ProjectSnapshot,
  SnapshotSection,
} from '@domain/project-status/project-snapshot.entity';
import { ProjectSnapshotDocument } from '@infrastructure/database/schemas/project-snapshot.schema';
import { ProjectSnapshotMapper } from '@infrastructure/database/mappers/project-snapshot.mapper';

@Injectable()
export class MongoProjectSnapshotRepository
  implements IProjectSnapshotRepository
{
  constructor(
    @InjectModel('ProjectSnapshot')
    private readonly model: Model<ProjectSnapshotDocument>,
  ) {}

  async save(sections: SnapshotSection[]): Promise<ProjectSnapshot> {
    const doc = await this.model.create({ sections });
    return ProjectSnapshotMapper.toDomain(doc);
  }

  async findLatest(): Promise<ProjectSnapshot | null> {
    const doc = await this.model.findOne().sort({ createdAt: -1 }).lean();
    return doc
      ? ProjectSnapshotMapper.toDomain(
          doc as unknown as ProjectSnapshotDocument,
        )
      : null;
  }

  async findLatestBefore(date: Date): Promise<ProjectSnapshot | null> {
    const doc = await this.model
      .findOne({ createdAt: { $lt: date } })
      .sort({ createdAt: -1 })
      .lean();
    return doc
      ? ProjectSnapshotMapper.toDomain(
          doc as unknown as ProjectSnapshotDocument,
        )
      : null;
  }

  async saveDigest(id: string, text: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { digest: text } });
  }

  async findLastDigest(
    before: Date,
  ): Promise<{ createdAt: Date; text: string } | null> {
    const doc = await this.model
      .findOne(
        { createdAt: { $lt: before }, digest: { $type: 'string' } },
        { digest: 1, createdAt: 1 },
      )
      .sort({ createdAt: -1 })
      .lean();
    return doc?.digest
      ? { createdAt: new Date(doc.createdAt), text: doc.digest }
      : null;
  }
}
