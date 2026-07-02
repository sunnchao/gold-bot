import { buildShadowReport } from '@gold-bot/observability';
import type { EaRecord, EaStore, ShadowComparison, ShadowRuntimeSnapshot } from '@gold-bot/persistence';

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

export type ShadowQualification = ShadowMetrics & {
  summary: ReturnType<typeof buildShadowReport>['checks'];
};

export class ShadowService {
  constructor(
    private readonly store: EaStore,
    private readonly nowIso: () => string
  ) {}

  metrics(): ShadowMetrics {
    const comparisons = this.store.listShadowComparisons();
    const totals = this.store.summarizeShadowComparisons();
    return {
      status: 'OK',
      generated_at: this.nowIso(),
      report: buildShadowReport(comparisons),
      totals: {
        comparisons: totals.comparisons,
        protocol_errors: totals.protocol_errors,
        signal_drifts: totals.signal_drifts,
        command_drifts: totals.command_drifts
      }
    };
  }

  qualification(): ShadowQualification {
    const metrics = this.metrics();
    return {
      ...metrics,
      summary: metrics.report.checks
    };
  }

  recordRuntimeSnapshot(input: ShadowRuntimeSnapshotInput): ShadowRuntimeSnapshot {
    const snapshot: ShadowRuntimeSnapshot = {
      account_id: input.account_id,
      symbol: input.symbol,
      source: input.source,
      signal: input.signal,
      command: input.command,
      created_at: input.created_at ?? this.nowIso()
    };
    this.store.saveShadowSnapshot(snapshot);
    return snapshot;
  }

  recordOracleComparison(input: ShadowComparisonInput): ShadowComparison {
    const runtimeSnapshot =
      input.node ??
      this.store.getLatestShadowSnapshot(input.account_id, input.symbol, input.source) ??
      null;
    if (runtimeSnapshot == null) {
      throw new Error('shadow runtime snapshot not found');
    }
    const comparison: ShadowComparison = {
      account_id: input.account_id,
      symbol: input.symbol,
      protocol_ok: input.protocol_ok ?? true,
      signal_drift: hasDrift(runtimeSnapshot.signal, input.oracle.signal),
      command_drift: hasDrift(runtimeSnapshot.command, input.oracle.command),
      oracle_compared: true,
      source: input.source,
      created_at: input.created_at ?? this.nowIso()
    };
    this.store.recordShadowComparison(comparison);
    return comparison;
  }
}

export type ShadowRuntimeSnapshotInput = {
  account_id: string;
  symbol: string;
  source: 'ea_analysis' | 'position_review' | 'ai_result';
  signal?: unknown;
  command?: unknown;
  created_at?: string;
};

export type ShadowComparisonInput = {
  account_id: string;
  symbol: string;
  source: 'ea_analysis' | 'position_review' | 'ai_result';
  protocol_ok?: boolean;
  created_at?: string;
  node?: {
    signal?: unknown;
    command?: unknown;
  };
  oracle: {
    signal?: unknown;
    command?: unknown;
  };
};

function hasDrift(left: unknown, right: unknown): boolean {
  return stableStringify(left) !== stableStringify(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalize(entry));
  }
  if (value != null && typeof value === 'object') {
    const record = value as EaRecord;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = normalize(record[key]);
    }
    return out;
  }
  return value ?? null;
}
