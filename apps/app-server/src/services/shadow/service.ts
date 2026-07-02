import { buildShadowReport } from '@gold-bot/observability';
import type { EaStore } from '@gold-bot/persistence';

export type ShadowMetrics = {
  status: 'OK';
  generated_at: string;
  report: ReturnType<typeof buildShadowReport>;
  totals: {
    comparisons: number;
    protocol_errors: number;
    signal_drifts: number;
    command_drifts: number;
  };
};

export class ShadowService {
  constructor(
    private readonly store: EaStore,
    private readonly nowIso: () => string
  ) {}

  metrics(): ShadowMetrics {
    const comparisons = this.store.listShadowComparisons();
    return {
      status: 'OK',
      generated_at: this.nowIso(),
      report: buildShadowReport(comparisons),
      totals: {
        comparisons: comparisons.length,
        protocol_errors: comparisons.filter((comparison) => !comparison.protocol_ok).length,
        signal_drifts: comparisons.filter((comparison) => comparison.signal_drift).length,
        command_drifts: comparisons.filter((comparison) => comparison.command_drift).length
      }
    };
  }
}
