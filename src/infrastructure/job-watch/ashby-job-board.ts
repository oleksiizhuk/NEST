import { Injectable } from '@nestjs/common';
import {
  IJobBoard,
  JobPosting,
} from '@application/job-watch/job-board.interface';

// Ashby's public posting API — the same data as jobs.ashbyhq.com/<board>,
// no key needed
const API = 'https://api.ashbyhq.com/posting-api/job-board';
const TIMEOUT_MS = 20_000;

interface AshbyLocation {
  location?: string | null;
}

interface AshbyJob {
  id?: string;
  title?: string | null;
  department?: string | null;
  team?: string | null;
  location?: string | null;
  secondaryLocations?: AshbyLocation[] | null;
  isListed?: boolean;
  workplaceType?: string | null;
  address?: {
    postalAddress?: {
      addressLocality?: string | null;
      addressCountry?: string | null;
    } | null;
  } | null;
  jobUrl?: string | null;
  publishedAt?: string | null;
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const toPosting = (board: string, job: AshbyJob): JobPosting | null => {
  const id = text(job.id);
  const title = text(job.title);
  if (!id || !title || job.isListed === false) return null;
  const places = [
    text(job.location),
    ...(job.secondaryLocations ?? []).map((l) => text(l?.location)),
    text(job.address?.postalAddress?.addressLocality),
    text(job.address?.postalAddress?.addressCountry),
  ].filter(Boolean);
  return {
    id,
    title,
    locations: [...new Set(places)],
    department: text(job.department),
    team: text(job.team),
    workplaceType: text(job.workplaceType),
    url:
      text(job.jobUrl) ||
      `https://jobs.ashbyhq.com/${encodeURIComponent(
        board,
      )}/${encodeURIComponent(id)}`,
    publishedAt: text(job.publishedAt) || null,
  };
};

@Injectable()
export class AshbyJobBoard implements IJobBoard {
  async list(board: string): Promise<JobPosting[]> {
    const response = await fetch(`${API}/${encodeURIComponent(board)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Ashby responded ${response.status}`);
    }
    const body = (await response.json()) as { jobs?: unknown };
    if (!Array.isArray(body?.jobs)) {
      throw new Error('Ashby sent no job list');
    }
    return (body.jobs as AshbyJob[])
      .map((job) => toPosting(board, job ?? {}))
      .filter((job): job is JobPosting => job !== null);
  }
}
