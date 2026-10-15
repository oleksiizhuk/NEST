import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  AuditCheck,
  AuditKind,
  AuditPhase,
  AuditRun,
  IAuditStore,
} from '@application/project-manager/audit.interface';
import { PmAuditDocument } from '@infrastructure/database/schemas/pm-audit.schema';

type Lean = {
  runId: string;
  status: string;
  phase: string;
  findings?: Record<string, string>;
  items?: Array<{
    kind: string;
    index: number;
    title: string;
    detail?: string;
    areas?: string[];
    repeat?: boolean;
    checkedBy?: { userId: number; name: string; at: Date } | null;
  }>;
  posts?: Array<{ kind: string; chatId: number; messageId: number }>;
  attempts?: number;
  error?: string | null;
  startedBy: string | number;
  startedAt: Date;
  finishedAt?: Date | null;
};

const kindOf = (k: string): AuditKind => (k === 'design' ? 'design' : 'tech');

const toRun = (doc: Lean): AuditRun => ({
  runId: doc.runId,
  status:
    doc.status === 'posted' || doc.status === 'failed' ? doc.status : 'running',
  phase: doc.phase as AuditPhase,
  findings: { ...(doc.findings ?? {}) },
  items: (doc.items ?? []).map((i) => ({
    kind: kindOf(i.kind),
    index: i.index,
    title: i.title,
    detail: i.detail ?? '',
    areas: i.areas ?? [],
    repeat: Boolean(i.repeat),
    checkedBy: i.checkedBy
      ? {
          userId: i.checkedBy.userId,
          name: i.checkedBy.name,
          at: new Date(i.checkedBy.at),
        }
      : null,
  })),
  posts: (doc.posts ?? []).map((p) => ({
    kind: kindOf(p.kind),
    chatId: p.chatId,
    messageId: p.messageId,
  })),
  attempts: doc.attempts ?? 0,
  error: doc.error ?? null,
  startedBy: doc.startedBy === 'cron' ? 'cron' : Number(doc.startedBy),
  startedAt: new Date(doc.startedAt),
  finishedAt: doc.finishedAt ? new Date(doc.finishedAt) : null,
});

@Injectable()
export class MongoAuditStore implements IAuditStore {
  constructor(
    @InjectModel('PmAudit') private readonly model: Model<PmAuditDocument>,
  ) {}

  async latest(): Promise<AuditRun | null> {
    const doc = await this.model.findOne().sort({ startedAt: -1 }).lean<Lean>();
    return doc ? toRun(doc) : null;
  }

  async lastPosted(): Promise<AuditRun | null> {
    const doc = await this.model
      .findOne({ status: 'posted' })
      .sort({ startedAt: -1 })
      .lean<Lean>();
    return doc ? toRun(doc) : null;
  }

  async get(runId: string): Promise<AuditRun | null> {
    if (typeof runId !== 'string') return null;
    const doc = await this.model.findOne({ runId }).lean<Lean>();
    return doc ? toRun(doc) : null;
  }

  async create(run: AuditRun): Promise<AuditRun | null> {
    try {
      const doc = await this.model.create({ ...run, stepUntil: null });
      return toRun(doc.toObject() as Lean);
    } catch (error) {
      // The partial unique index: another run is in progress
      if ((error as { code?: number }).code === 11000) return null;
      throw error;
    }
  }

  async update(
    runId: string,
    patch: Parameters<IAuditStore['update']>[1],
  ): Promise<AuditRun | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { runId, status: 'running' },
        { $set: patch },
        { new: true },
      )
      .lean<Lean>();
    return doc ? toRun(doc) : null;
  }

  // Two conditional writes, each atomic: tick an unticked item, else untick
  // a ticked one. Two people tapping at once end up as tick then untick,
  // never as a lost write.
  async toggle(
    runId: string,
    kind: AuditKind,
    index: number,
    who: AuditCheck,
  ): Promise<AuditRun | null> {
    const ticked = await this.model
      .findOneAndUpdate(
        { runId, items: { $elemMatch: { kind, index, checkedBy: null } } },
        { $set: { 'items.$[it].checkedBy': who } },
        {
          arrayFilters: [
            { 'it.kind': kind, 'it.index': index, 'it.checkedBy': null },
          ],
          new: true,
        },
      )
      .lean<Lean>();
    if (ticked) return toRun(ticked);
    const cleared = await this.model
      .findOneAndUpdate(
        {
          runId,
          items: { $elemMatch: { kind, index, checkedBy: { $ne: null } } },
        },
        { $set: { 'items.$[it].checkedBy': null } },
        {
          arrayFilters: [
            {
              'it.kind': kind,
              'it.index': index,
              'it.checkedBy': { $ne: null },
            },
          ],
          new: true,
        },
      )
      .lean<Lean>();
    return cleared ? toRun(cleared) : null;
  }

  async claimStep(runId: string, until: Date): Promise<AuditRun | null> {
    const doc = await this.model
      .findOneAndUpdate(
        {
          runId,
          status: 'running',
          $or: [{ stepUntil: null }, { stepUntil: { $lt: new Date() } }],
        },
        { $set: { stepUntil: until } },
        { new: true },
      )
      .lean<Lean>();
    return doc ? toRun(doc) : null;
  }

  async releaseStep(runId: string): Promise<void> {
    await this.model.updateOne({ runId }, { $set: { stepUntil: null } });
  }
}
