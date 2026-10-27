import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  IPmConfig,
  PM_CONFIG,
} from '@application/project-manager/pm.config.interface';
import {
  IPmSettingsStore,
  PM_SETTINGS,
  resolveConfig,
} from '@application/project-manager/settings.interface';

// Settings change rarely; every instance re-reads them at most this often
const TTL_MS = 30_000;
const RETRY_MS = 5_000;

// The effective project-manager config: env values with the owner's
// admin-page overrides. A store failure keeps the last config read (personal
// mode must not switch itself off on one slow query), else the env config.
// A failed read is retried after a few seconds, not the full TTL.
@Injectable()
export class PmRuntimeConfig {
  private readonly logger = new Logger(PmRuntimeConfig.name);
  private cached: { at: number; config: IPmConfig } | null = null;
  private lastGood: IPmConfig | null = null;

  constructor(
    @Inject(PM_CONFIG) private readonly base: IPmConfig,
    @Optional() @Inject(PM_SETTINGS) private readonly store?: IPmSettingsStore,
  ) {}

  async current(now = Date.now()): Promise<IPmConfig> {
    if (this.cached && now - this.cached.at < TTL_MS) return this.cached.config;
    if (!this.store) {
      this.cached = { at: now, config: this.base };
      return this.base;
    }
    try {
      const config = resolveConfig(this.base, (await this.store.get()).values);
      this.lastGood = config;
      this.cached = { at: now, config };
      return config;
    } catch (error) {
      this.logger.error(`settings not loaded: ${error}`);
      const config = this.lastGood ?? this.base;
      this.cached = { at: now - TTL_MS + RETRY_MS, config };
      return config;
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  defaults(): IPmConfig {
    return this.base;
  }
}
