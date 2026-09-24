export type SnapshotSource = 'issues' | 'docs' | 'code' | 'design';

export interface SnapshotSection {
  source: SnapshotSource;
  ok: boolean;
  fetchedAt: Date;
  // Compact, model-ready text; empty when the source failed and had no
  // earlier copy to fall back on
  text: string;
  error: string | null;
  // Numbers computed from this section's data (open items, PRs waiting…),
  // kept so later snapshots can show the trend
  metrics?: Record<string, number>;
  // Events for proactive alerts (rule + subject + text), from fresh data only
  signals?: Array<{ rule: string; subject: string; text: string }>;
  // Structured per-person data for the admin page
  details?: Record<string, unknown>;
}

export class ProjectSnapshot {
  constructor(
    public readonly id: string,
    public readonly createdAt: Date,
    public readonly sections: SnapshotSection[],
    // The digest posted from this snapshot, if any
    public readonly digest: string | null = null,
  ) {}

  ageHours(now: Date): number {
    return (now.getTime() - this.createdAt.getTime()) / 3_600_000;
  }

  isOlderThan(now: Date, hours: number): boolean {
    return this.ageHours(now) > hours;
  }

  section(source: SnapshotSource): SnapshotSection | undefined {
    return this.sections.find((s) => s.source === source);
  }

  // Byte-stable for the same snapshot, which keeps the prompt cache warm
  // across every question asked about it.
  render(): string {
    const header = `<snapshot generated_at="${this.createdAt.toISOString()}">`;
    const body = this.sections.map((s) => {
      const status = s.ok
        ? `fetched ${s.fetchedAt.toISOString()}`
        : `FAILED (${s.error ?? 'unknown error'}) — ${
            s.text
              ? `showing data from ${s.fetchedAt.toISOString()}`
              : 'no data'
          }`;
      return `<${s.source} status="${status}">\n${s.text}\n</${s.source}>`;
    });
    return [header, ...body, '</snapshot>'].join('\n');
  }
}
