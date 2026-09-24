import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  IIndexJob,
  IIndexReader,
  INDEX_SOURCES,
  IndexJobState,
  IndexSource,
  IProjectIndex,
  PM_INDEX,
  PM_INDEX_JOB,
  PM_INDEX_READERS,
} from '@application/project-manager/project-index.interface';

// Inside the 300 s function limit, leaving room for one slow page
const STEP_BUDGET_MS = 200_000;

// Collects everything in steps: each call reads pages until its time budget
// is spent and saves where it stopped; the next call continues. Only source
// APIs are called — no model.
@Injectable()
export class BuildIndexUseCase {
  private readonly logger = new Logger(BuildIndexUseCase.name);

  constructor(
    @Inject(PM_INDEX) private readonly index: IProjectIndex,
    @Inject(PM_INDEX_JOB) private readonly job: IIndexJob,
    @Inject(PM_INDEX_READERS) private readonly readers: IIndexReader[],
  ) {}

  private configured(): IndexSource[] {
    return INDEX_SOURCES.filter((s) =>
      this.readers.some((r) => r.source === s && r.isConfigured()),
    );
  }

  async status(): Promise<{
    job: IndexJobState | null;
    counts: Partial<Record<IndexSource, number>>;
    sources: IndexSource[];
  }> {
    const [job, counts] = await Promise.all([
      this.job.get(),
      this.index.counts(),
    ]);
    return { job, counts, sources: this.configured() };
  }

  // A running job continues; otherwise a new run starts
  async start(now = new Date()): Promise<IndexJobState> {
    const current = await this.job.get();
    if (current?.status === 'running') return current;
    const sources = this.configured();
    const state: IndexJobState = {
      runId: randomBytes(6).toString('hex'),
      status: sources.length ? 'running' : 'done',
      stage: sources[0] ?? 'done',
      cursor: null,
      counts: {},
      startedAt: now,
      finishedAt: sources.length ? null : now,
      error: null,
    };
    await this.job.save(state);
    return state;
  }

  async step(budgetMs = STEP_BUDGET_MS): Promise<IndexJobState> {
    const state = await this.job.get();
    if (!state || state.status !== 'running') {
      return state ?? (await this.start());
    }
    const until = Date.now() + budgetMs;
    const order = this.configured();
    try {
      while (state.stage !== 'done' && Date.now() < until) {
        const reader = this.readers.find(
          (r) => r.source === state.stage && r.isConfigured(),
        );
        if (!reader) {
          this.advance(state, order);
          continue;
        }
        const { docs, next } = await reader.page(state.cursor);
        if (docs.length) await this.index.upsert(docs, state.runId);
        state.counts[reader.source] =
          (state.counts[reader.source] ?? 0) + docs.length;
        state.cursor = next;
        if (!next) {
          await this.index.removeStale(reader.source, state.runId);
          this.advance(state, order);
        }
        await this.job.save(state);
      }
      if (state.stage === 'done') {
        state.status = 'done';
        state.finishedAt = new Date();
      }
    } catch (error) {
      state.status = 'failed';
      state.error = `${state.stage}: ${String(
        (error as Error)?.message ?? error,
      ).slice(0, 300)}`;
      this.logger.error(`index build failed: ${state.error}`);
    }
    await this.job.save(state);
    return state;
  }

  private advance(state: IndexJobState, order: IndexSource[]) {
    const next = order[order.indexOf(state.stage as IndexSource) + 1];
    state.stage = next ?? 'done';
    state.cursor = null;
  }
}
