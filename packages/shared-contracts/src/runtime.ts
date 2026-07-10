export const runtimeModes = ['oracle', 'shadow', 'cutover', 'rollback'] as const;
export type RuntimeMode = (typeof runtimeModes)[number];

export const commandStatuses = ['draft', 'shadow_only', 'queued', 'delivered', 'acked', 'rejected', 'failed', 'superseded'] as const;
export type CommandStatus = (typeof commandStatuses)[number];

export const commandSources = ['ea_analysis', 'live_strategy', 'position_review', 'ai_stop_loss', 'ai_result', 'ai_risk_alert', 'ai_approve', 'position_manager'] as const;
export type CommandSource = (typeof commandSources)[number];

export function isRuntimeMode(value: string): value is RuntimeMode {
  return (runtimeModes as readonly string[]).includes(value);
}

export function isCommandStatus(value: string): value is CommandStatus {
  return (commandStatuses as readonly string[]).includes(value);
}

export function isCommandSource(value: string): value is CommandSource {
  return (commandSources as readonly string[]).includes(value);
}
