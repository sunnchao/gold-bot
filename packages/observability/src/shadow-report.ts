import type { ShadowComparison } from '@gold-bot/persistence';

export type CutoverCheckTone = 'green' | 'orange' | 'amber' | 'red';

export type CutoverCheck = {
  label: string;
  value: string;
  detail: string;
  tone: CutoverCheckTone;
};

export type CutoverReport = {
  ready: boolean;
  protocol_error_rate: number;
  signal_drift_rate: number;
  command_drift_rate: number;
  last_shadow_event_at: string;
  missing_capabilities: string[];
  checks: CutoverCheck[];
};

export function buildShadowReport(comparisons: ShadowComparison[]): CutoverReport {
  const lastShadowEventAt = comparisons[comparisons.length - 1]?.created_at ?? '';

  if (comparisons.length === 0) {
    return {
      ready: false,
      protocol_error_rate: 0,
      signal_drift_rate: 0,
      command_drift_rate: 0,
      last_shadow_event_at: lastShadowEventAt,
      missing_capabilities: ['shadow_traffic'],
      checks: buildCutoverChecks({
        hasShadowTraffic: false,
        hasOracleReference: false,
        protocolErrorRate: 0,
        signalDriftRate: 0,
        commandDriftRate: 0
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
      last_shadow_event_at: lastShadowEventAt,
      missing_capabilities: ['go_oracle_reference'],
      checks: buildCutoverChecks({
        hasShadowTraffic: true,
        hasOracleReference: false,
        protocolErrorRate: 0,
        signalDriftRate: 0,
        commandDriftRate: 0
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

  return {
    ready: protocolErrorRate === 0 && signalDriftRate <= 0.02 && commandDriftRate <= 0.02,
    protocol_error_rate: protocolErrorRate,
    signal_drift_rate: signalDriftRate,
    command_drift_rate: commandDriftRate,
    last_shadow_event_at: lastShadowEventAt,
    missing_capabilities: [],
    checks: buildCutoverChecks({
      hasShadowTraffic: true,
      hasOracleReference: true,
      protocolErrorRate,
      signalDriftRate,
      commandDriftRate
    })
  };
}

type CutoverInputs = {
  hasShadowTraffic: boolean;
  hasOracleReference: boolean;
  protocolErrorRate: number;
  signalDriftRate: number;
  commandDriftRate: number;
};

function buildCutoverChecks(inputs: CutoverInputs): CutoverCheck[] {
  return [
    buildOracleReplayCheck(inputs.hasOracleReference, inputs.hasShadowTraffic),
    buildShadowDriftCheck(inputs.hasShadowTraffic, inputs.signalDriftRate, inputs.commandDriftRate),
    buildProtocolCheck(inputs.hasShadowTraffic, inputs.protocolErrorRate)
  ];
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
