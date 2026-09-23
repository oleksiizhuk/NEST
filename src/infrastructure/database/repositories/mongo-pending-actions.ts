import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  ActionStatus,
  IPendingActions,
  PendingAction,
} from '@application/project-manager/pending-action.interface';
import { PmActionDocument } from '@infrastructure/database/schemas/pm-action.schema';

// Unambiguous characters only: easy to type back in /confirm
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newActionId = (): string =>
  Array.from(randomBytes(5), (b) => ALPHABET[b % ALPHABET.length]).join('');

const toAction = (d: PmActionDocument): PendingAction => ({
  id: d.actionId,
  kind: d.kind as PendingAction['kind'],
  payload: d.payload as unknown as PendingAction['payload'],
  summary: d.summary,
  chatId: d.chatId,
  requesterId: d.requesterId,
  status: d.status as ActionStatus,
  expiresAt: new Date(d.expiresAt),
  result: d.result ?? null,
});

@Injectable()
export class MongoPendingActions implements IPendingActions {
  constructor(
    @InjectModel('PmAction') private readonly model: Model<PmActionDocument>,
  ) {}

  async create(
    action: Omit<PendingAction, 'id' | 'status' | 'result'>,
  ): Promise<PendingAction> {
    const doc = await this.model.create({
      ...action,
      actionId: newActionId(),
      status: 'pending',
    });
    return toAction(doc);
  }

  async claim(
    id: string,
    chatId: number,
    confirmedBy: number,
    now: Date,
  ): Promise<PendingAction | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { actionId: id, chatId, status: 'pending', expiresAt: { $gt: now } },
        { $set: { status: 'executing', confirmedBy } },
        { new: true },
      )
      .lean();
    return doc ? toAction(doc as unknown as PmActionDocument) : null;
  }

  async latestPending(
    chatId: number,
    now: Date,
  ): Promise<PendingAction | null> {
    const doc = await this.model
      .findOne({ chatId, status: 'pending', expiresAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .lean();
    return doc ? toAction(doc as unknown as PmActionDocument) : null;
  }

  async finish(
    id: string,
    status: ActionStatus,
    result: string,
  ): Promise<void> {
    await this.model.updateOne({ actionId: id }, { $set: { status, result } });
  }

  async cancel(id: string, chatId: number): Promise<boolean> {
    const res = await this.model.updateOne(
      { actionId: id, chatId, status: 'pending' },
      { $set: { status: 'cancelled' } },
    );
    return res.modifiedCount === 1;
  }

  async recent(
    limit: number,
  ): Promise<Array<PendingAction & { createdAt: Date }>> {
    const docs = await this.model
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((d) => ({
      ...toAction(d as unknown as PmActionDocument),
      createdAt: new Date((d as unknown as PmActionDocument).createdAt),
    }));
  }
}
