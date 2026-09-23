export type SnapshotSource = 'issues' | 'docs' | 'code' | 'design';

export interface SnapshotSection {
  source: SnapshotSource;
  ok: boolean;
  fetchedAt: Date;
  // Compact, model-ready text; empty when the source failed and had no
  // earlier copy to fall back on
  text: string;
  error: string | null;
}

export class ProjectSnapshot {
  constructor(
    public readonly id: string,
    public readonly createdAt: Date,
    public readonly sections: SnapshotSection[],
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
