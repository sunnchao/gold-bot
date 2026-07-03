import { describe, expect, it } from 'vitest';
import { commandSources, commandStatuses, isCommandSource, isCommandStatus, isRuntimeMode, runtimeModes } from './runtime.js';

describe('runtime contracts', () => {
  it('freezes the supported runtime modes', () => {
    expect(runtimeModes).toEqual(['oracle', 'shadow', 'cutover', 'rollback']);
  });

  it('freezes the supported command statuses and sources', () => {
    expect(commandStatuses).toEqual(['draft', 'shadow_only', 'queued', 'delivered', 'acked', 'rejected', 'failed', 'superseded']);
    expect(commandSources).toEqual(['ea_analysis', 'live_strategy', 'position_review', 'ai_result', 'ai_risk_alert', 'ai_approve']);
  });

  it('recognizes valid runtime types and rejects unknown ones', () => {
    expect(isRuntimeMode('oracle')).toBe(true);
    expect(isRuntimeMode('live')).toBe(false);
    expect(isCommandStatus('queued')).toBe(true);
    expect(isCommandStatus('pending')).toBe(false);
    expect(isCommandSource('ai_result')).toBe(true);
    expect(isCommandSource('ai_risk_alert')).toBe(true);
    expect(isCommandSource('ai_approve')).toBe(true);
    expect(isCommandSource('live_strategy')).toBe(true);
    expect(isCommandSource('manual')).toBe(false);
  });
});
