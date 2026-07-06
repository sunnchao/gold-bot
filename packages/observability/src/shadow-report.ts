import type { ShadowComparison } from '@gold-bot/persistence';

export type CutoverCheckTone = 'green' | 'orange' | 'amber' | 'red';

export type CutoverCheck = {
  label: string;
  value: string;
  detail: string;
  tone: CutoverCheckTone;
};

export type ReplayCoverageSummary = {
  total: number;
  validated: number;
};

export type CutoverReport = {
  ready: boolean;
  protocol_error_rate: number;
  signal_drift_rate: number;
  command_drift_rate: number;
  replay_coverage: number;
  last_shadow_event_at: string;
  missing_capabilities: string[];
  checks: CutoverCheck[];
};

export function buildShadowReport(
  comparisons: ShadowComparison[],
  replayCoverage: ReplayCoverageSummary | null = null
): CutoverReport {
  const lastShadowEventAt = comparisons[comparisons.length - 1]?.created_at ?? '';
  const replayCoverageRate = replayCoverage == null || replayCoverage.total === 0
    ? 0
    : replayCoverage.validated / replayCoverage.total;

  if (comparisons.length === 0) {
    return {
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      replay_coverage: replayCoverageRate,
      last_shadow_event_at: lastShadowEventAt,
      missing_capabilities: replayCoverage == null ? ['shadow_traffic'] : ['shadow_traffic', 'replay_coverage'],
      checks: buildCutoverChecks({
        hasShadowTraffic: false,
        hasOracleReference: false,
        protocolErrorRate: 0,
        signalDriftRate: 0,
        commandDriftRate: 0,
        replayCoverage: replayCoverage
      })
    };
  }

  const compared = comparisons.filter((comparison) => comparison.oracle_compared);
  if (compared.length === 0) {
    return {
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      replay_coverage: replayCoverageRate,
      last_shadow_event_at: lastShadowEventAt,
      missing_capabilities: replayCoverage == null ? ['go_oracle_reference'] : ['go_oracle_reference', 'replay_coverage'],
      checks: buildCutoverChecks({
        hasShadowTraffic: true,
        hasOracleReference: false,
        protocolErrorRate: 0,
        signalDriftRate: 0,
        commandDriftRate: 0,
        replayCoverage: replayCoverage
      })
    };
  }

  const protocolErrors = compared.filter((comparison) => !comparison.protocol_ok).length;
  const signalDrifts = compared.filter((comparison) => comparison.signal_drift).length;
  const commandDrifts = compared.filter((comparison) => comparison.command_drift).length;
  const total = compared.length;
  const protocolErrorRate = protocolErrors / total;
  const signalDriftRate = signalDrifts / total;
  const commandDriftRate = commandDrifts / total;

  const replayCoverageMissing = replayCoverage == null || replayCoverageRate < 1;
  return {
    ready: protocolErrorRate === 0 && signalDriftRate <= 0.02 && commandDriftRate <= 0.02 && !replayCoverageMissing,
    protocol_error_rate: protocolErrorRate,
    signal_drift_rate: signalDriftRate,
    command_drift_rate: commandDriftRate,
    replay_coverage: replayCoverageRate,
    last_shadow_event_at: lastShadowEventAt,
    missing_capabilities: replayCoverageMissing ? ['replay_coverage'] : [],
    checks: buildCutoverChecks({
      hasShadowTraffic: true,
      hasOracleReference: true,
      protocolErrorRate,
      signalDriftRate,
      commandDriftRate,
      replayCoverage: replayCoverage
    })
  };
}

type CutoverInputs = {
  hasShadowTraffic: boolean;
  hasOracleReference: boolean;
  protocolErrorRate: number;
  signalDriftRate: number;
  commandDriftRate: number;
  replayCoverage: ReplayCoverageSummary | null;
};

function buildCutoverChecks(inputs: CutoverInputs): CutoverCheck[] {
  return [
    buildOracleReplayCheck(inputs.hasOracleReference, inputs.hasShadowTraffic),
    buildShadowDriftCheck(inputs.hasShadowTraffic, inputs.signalDriftRate, inputs.commandDriftRate),
    buildProtocolCheck(inputs.hasShadowTraffic, inputs.protocolErrorRate),
    buildReplayCoverageCheck(inputs.replayCoverage)
  ];
}

function buildReplayCoverageCheck(coverage: ReplayCoverageSummary | null): CutoverCheck {
  if (coverage == null) {
    return {
      label: 'Replay Coverage',
      value: 'pending',
      detail: 'Replay fixture set has not been scanned yet',
      tone: 'amber'
    };
  }

  if (coverage.total === 0) {
    return {
      label: 'Replay Coverage',
      value: 'pending',
      detail: 'No replay fixture pairs have been recorded yet',
      tone: 'amber'
    };
  }

  const rate = coverage.validated / coverage.total;
  if (rate >= 1) {
    return {
      label: 'Replay Coverage',
      value: '100.00%',
      detail: `${coverage.validated}/${coverage.total} Go fixtures reproduced by Node replay`,
      tone: 'green'
    };
  }

  if (rate > 0) {
    return {
      label: 'Replay Coverage',
      value: formatRate(rate),
      detail: `${coverage.validated}/${coverage.total} Go fixtures reproduced (raw pass requires 100%)`,
      tone: 'amber'
    };
  }

  return {
    label: 'Replay Coverage',
    value: '0.00%',
    detail: `${coverage.total} fixture(s) not yet reproduced by Node replay`,
    tone: 'red'
  };
}

function buildOracleReplayCheck(hasOracleReference: boolean, hasShadowTraffic: boolean): CutoverCheck {
  if (hasOracleReference) {
    return {
      label: 'Oracle Replay',
      value: 'validated',
      detail: 'Go oracle comparisons are flowing into the shadow stream',
      tone: 'green'
    };
  }

  return {
    label: 'Oracle Replay',
    value: 'pending',
    detail: hasShadowTraffic
      ? 'Go oracle comparisons have not been approved yet'
      : 'No Go oracle comparisons have been recorded yet',
    tone: 'orange'
  };
}

function buildShadowDriftCheck(
  hasShadowTraffic: boolean,
  signalDriftRate: number,
  commandDriftRate: number
): CutoverCheck {
  if (!hasShadowTraffic) {
    return {
      label: 'Shadow Drift',
      value: 'pending',
      detail: 'Waiting for mirrored production traffic',
      tone: 'orange'
    };
  }

  if (signalDriftRate <= 0.02 && commandDriftRate <= 0.02) {
    return {
      label: 'Shadow Drift',
      value: 'within threshold',
      detail: `Signal ${formatRate(signalDriftRate)}, command ${formatRate(commandDriftRate)}`,
      tone: 'green'
    };
  }

  return {
    label: 'Shadow Drift',
    value: 'review required',
    detail: `Signal ${formatRate(signalDriftRate)}, command ${formatRate(commandDriftRate)} (limit 2.00%)`,
    tone: 'red'
  };
}

function buildProtocolCheck(hasShadowTraffic: boolean, protocolErrorRate: number): CutoverCheck {
  if (!hasShadowTraffic) {
    return {
      label: 'Protocol Errors',
      value: formatRate(protocolErrorRate),
      detail: 'Live shadow traffic has not started yet',
      tone: 'amber'
    };
  }

  if (protocolErrorRate > 0) {
    return {
      label: 'Protocol Errors',
      value: formatRate(protocolErrorRate),
      detail: 'Legacy contract mismatches detected in mirrored traffic',
      tone: 'red'
    };
  }

  return {
    label: 'Protocol Errors',
    value: formatRate(protocolErrorRate),
    detail: 'No contract mismatches observed in mirrored traffic',
    tone: 'green'
  };
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}
