import type { ShadowComparison } from '@gold-bot/persistence';

export type CutoverReport = {
  ready: boolean;
  protocol_error_rate: number;
  signal_drift_rate: number;
  command_drift_rate: number;
  last_shadow_event_at: string;
  missing_capabilities: string[];
};

export function buildShadowReport(comparisons: ShadowComparison[]): CutoverReport {
  if (comparisons.length === 0) {
    return {
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      last_shadow_event_at: '',
      missing_capabilities: ['shadow_traffic']
    };
  }

  const compared = comparisons.filter((comparison) => comparison.oracle_compared);
  if (compared.length === 0) {
    return {
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      last_shadow_event_at: comparisons[comparisons.length - 1]?.created_at ?? '',
      missing_capabilities: ['go_oracle_reference']
    };
  }

  const protocolErrors = compared.filter((comparison) => !comparison.protocol_ok).length;
  const signalDrifts = compared.filter((comparison) => comparison.signal_drift).length;
  const commandDrifts = compared.filter((comparison) => comparison.command_drift).length;
  const total = compared.length;
  const protocolErrorRate = protocolErrors / total;
  const signalDriftRate = signalDrifts / total;
  const commandDriftRate = commandDrifts / total;

  return {
    ready: protocolErrorRate === 0 && signalDriftRate <= 0.02 && commandDriftRate <= 0.02,
    protocol_error_rate: protocolErrorRate,
    signal_drift_rate: signalDriftRate,
    command_drift_rate: commandDriftRate,
    last_shadow_event_at: comparisons[comparisons.length - 1]?.created_at ?? '',
    missing_capabilities: []
  };
}
